import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { AnimatePresence } from 'motion/react';
import { RefreshCcw, ChevronRight } from 'lucide-react';
import { GameState, WeaponType, AttachmentType, Difficulty } from '@/types';
import { CHAPTERS, WEAPONS_DATA } from '@/constants';
import { initAudio, playFireSound, playReloadSound, playMedikitSound, playHitSound, playFootstep, playKillStreakSound } from '@/hooks/useAudioEngine';
import { useMusicEngine } from '@/hooks/useMusicEngine';
import { getTerrainType, getTerrainHeight, BOAT_SPAWN_POSITION } from '@/components/Environment';

// Components
import WeaponViewModel from '@/components/WeaponViewModel';
import World from '@/components/World';
import PostProcessing from '@/components/PostProcessing';
import { BloodParticles, ShellParticles, MuzzleSmokeParticles } from '@/components/Particles';
import HUD from '@/components/HUD';
import { PrologueScreen, StoryScreen } from '@/components/PrologueScreen';
import { CutsceneOverlay, getCutsceneForChapter } from '@/components/CutsceneOverlay';
import MainMenu from '@/components/MainMenu';
import SettingsMenu from '@/components/SettingsMenu';
import InventoryScreen from '@/components/InventoryScreen';
import LoadGameScreen from '@/components/LoadGameScreen';
import WeaponStatsScreen from '@/components/WeaponStatsScreen';

// --- Movement vectors (module-level for perf) ---
const frontVector = { current: new THREE.Vector3() };
const sideVector = { current: new THREE.Vector3() };
const inputDirection = { current: new THREE.Vector3() };

function PlayerTracker({ terrainType, sfxVolume, masterVolume, footstepVolume, mouseSensitivity, baseFov, state, setState, cameraRef, playerPos }: { 
  terrainType: string, sfxVolume: number, masterVolume: number,
  footstepVolume: number, mouseSensitivity: number, baseFov: number,
  state: GameState, setState: React.Dispatch<React.SetStateAction<GameState>>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  playerPos: React.MutableRefObject<THREE.Vector3>
}) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const velocity = useRef(new THREE.Vector3());
  const distanceTraveled = useRef(0);
  const lastStepDistance = useRef(0);
  const aimTime = useRef(0);
  const prevSwayX = useRef(0);
  const prevSwayY = useRef(0);

  // ── Mouse sensitivity — full override of PLControls mouse look ──────
  useEffect(() => {
    const canvas = gl.domElement;
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      // Run before PLControls (capture phase) and block it from also rotating
      e.stopImmediatePropagation();
      const sens = mouseSensitivity * 0.002;
      (camera as THREE.PerspectiveCamera).rotation.order = 'YXZ';
      camera.rotation.y -= e.movementX * sens;
      camera.rotation.x -= e.movementY * sens;
      // Clamp vertical look to avoid gimbal flip
      camera.rotation.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, camera.rotation.x));
    };
    canvas.addEventListener('mousemove', onMouseMove, { capture: true });
    return () => canvas.removeEventListener('mousemove', onMouseMove, { capture: true } as any);
  }, [mouseSensitivity, camera, gl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { 
      keys.current[e.code] = true; 
      if (e.code === state.settings.keybinds.crouch || e.code === 'ControlLeft') {
        setState(prev => ({ ...prev, isCrouching: true }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { 
      keys.current[e.code] = false; 
      if (e.code === state.settings.keybinds.crouch || e.code === 'ControlLeft') {
        const isStillCrouching = keys.current[state.settings.keybinds.crouch] || keys.current['ControlLeft'];
        if (!isStillCrouching) setState(prev => ({ ...prev, isCrouching: false }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [state.settings.keybinds.crouch, setState]);

  useFrame((three: any, delta) => {
    const dt = Math.min(delta, 0.1);
    cameraRef.current = camera as THREE.PerspectiveCamera;
    if (state.isPaused || state.isGameOver || state.showStory || !state.isLocked || state.isInventoryOpen) return;

    const isSprinting = keys.current[state.settings.keybinds.sprint] || keys.current['ShiftRight'];
    const isCrouching = state.isCrouching;
    const baseSpeed = isSprinting ? 12 : (isCrouching ? 3 : 6);
    
    frontVector.current.set(0, 0, Number(keys.current[state.settings.keybinds.moveBackward] || false) - Number(keys.current[state.settings.keybinds.moveForward] || false));
    sideVector.current.set(Number(keys.current[state.settings.keybinds.moveRight] || false) - Number(keys.current[state.settings.keybinds.moveLeft] || false), 0, 0);

    inputDirection.current.set(0, 0, 0).add(frontVector.current).add(sideVector.current).normalize().multiplyScalar(baseSpeed).applyEuler(camera.rotation);

    velocity.current.lerp(inputDirection.current, 10 * dt);

    // ── Candidate position after movement ───────────────────────────────
    const nextPos = camera.position.clone().add(velocity.current.clone().multiplyScalar(dt));

    // ── Structure AABB collision (push player out of solid objects) ─────
    // Each structure is treated as a box: width/depth = 3 units, height = 4 units.
    // We use a horizontal capsule radius of 0.6 for the player.
    const PLAYER_RADIUS = 0.6;
    const structuresData: { x: number; z: number; hw: number; hd: number }[] = (
      (three as any)._structureColliders || []
    );
    for (const s of structuresData) {
      const dx = nextPos.x - Math.max(s.x - s.hw, Math.min(nextPos.x, s.x + s.hw));
      const dz = nextPos.z - Math.max(s.z - s.hd, Math.min(nextPos.z, s.z + s.hd));
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) {
        // Push out along X or Z, whichever is shorter
        const overlapX = (s.x + s.hw + PLAYER_RADIUS) - nextPos.x;
        const overlapNX = nextPos.x - (s.x - s.hw - PLAYER_RADIUS);
        const overlapZ = (s.z + s.hd + PLAYER_RADIUS) - nextPos.z;
        const overlapNZ = nextPos.z - (s.z - s.hd - PLAYER_RADIUS);
        const minOverlap = Math.min(Math.abs(overlapX), Math.abs(overlapNX), Math.abs(overlapZ), Math.abs(overlapNZ));
        if (minOverlap === Math.abs(overlapX)) nextPos.x -= overlapX;
        else if (minOverlap === Math.abs(overlapNX)) nextPos.x += overlapNX;
        else if (minOverlap === Math.abs(overlapZ)) nextPos.z -= overlapZ;
        else nextPos.z += overlapNZ;
        velocity.current.x = 0;
        velocity.current.z = 0;
      }
    }

    // ── World boundary clamp ─────────────────────────────────────────────
    const WORLD_BOUND = 120;
    nextPos.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, nextPos.x));
    nextPos.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, nextPos.z));

    camera.position.x = nextPos.x;
    camera.position.z = nextPos.z;

    // Snap player to terrain surface
    const terrainY = getTerrainHeight(camera.position.x, camera.position.z, terrainType);
    const eyeHeight = isCrouching ? 1.0 : 1.7;
    camera.position.y = terrainY + eyeHeight;

    playerPos.current.copy(camera.position);
    playerPos.current.y = terrainY;

    // ── Objective-reach detection for 0-enemy story chapters ──────────
    if (!state.isZoneCompleted && !state.showStory) {
      const ch = CHAPTERS.find(c => c.id === state.currentChapter);
      if (ch?.objectivePosition && ch.enemyCount === 0) {
        const [ox, oz] = ch.objectivePosition;
        const distSq = (playerPos.current.x - ox) ** 2 + (playerPos.current.z - oz) ** 2;
        if (distSq < 25) {
          setState(prev => {
            if (prev.isZoneCompleted) return prev; // already triggered
            const newWeapons = (ch.unlocks && !prev.weapons.find(w => w.type === ch.unlocks))
              ? [...prev.weapons, { ...WEAPONS_DATA[ch.unlocks!], attachments: [] }]
              : prev.weapons;
            return { ...prev, weapons: newWeapons, showZoneCompletionPrompt: true, isZoneCompleted: true };
          });
        }
      }
    }

    // Update stealth + running (only setState when values actually change)
    const isMoving = velocity.current.length() > 0.5;
    const currentWeapon = state.weapons[state.currentWeaponIndex];
    const hasSilencer = currentWeapon?.attachments.includes(AttachmentType.SILENCER);
    const timeSinceShot = Date.now() - (three._lastShotTime || 0);
    
    let targetStealth = 1.0;
    if (isCrouching && !isMoving) targetStealth = 0.2;
    else if (isCrouching) targetStealth = 0.4;
    else if (!isMoving) targetStealth = 0.6;
    if (hasSilencer) targetStealth *= 0.7;
    if (isSprinting) targetStealth = 1.0;
    
    const newStealth = state.stealthLevel + (targetStealth - state.stealthLevel) * 0.05;
    const newRunning = isSprinting && isMoving;
    // Only call setState when something meaningful changed (thresholds to reduce re-renders)
    const stealthChanged = Math.abs(newStealth - state.stealthLevel) > 0.02;
    const runningChanged = newRunning !== state.isRunning;
    const shakeChanged = state.screenShake > 0.01;

    if (stealthChanged || runningChanged || shakeChanged) {
      setState(prev => ({
        ...prev, 
        stealthLevel: stealthChanged ? newStealth : prev.stealthLevel,
        isRunning: runningChanged ? newRunning : prev.isRunning,
        screenShake: shakeChanged ? Math.max(0, prev.screenShake - dt * 4) : 0,
      }));
    }

    // Footsteps and head bob
    if (velocity.current.length() > 0.1) {
      distanceTraveled.current += velocity.current.length() * delta;
      const stepThreshold = isSprinting ? 2.5 : (isCrouching ? 3.0 : 2.0);
      const stepVolume = isCrouching ? 0.3 : (isSprinting ? 1.2 : 0.8);
      const effectiveFootstepVol = (footstepVolume / 100) * stepVolume;
      if (distanceTraveled.current - lastStepDistance.current > stepThreshold) {
        playFootstep(terrainType, effectiveFootstepVol, isSprinting ? 1.1 : 1.0, sfxVolume, masterVolume);
        lastStepDistance.current = distanceTraveled.current;
      }
      const bobAmount = isSprinting ? 0.08 : (isCrouching ? 0.02 : 0.05);
      const bobFreq = isSprinting ? 12 : (isCrouching ? 6 : 8);
      camera.position.y += Math.sin(distanceTraveled.current * bobFreq) * bobAmount;
    }

    // FOV
    const hasScope = currentWeapon?.attachments.includes(AttachmentType.SCOPE);
    const targetFov = state.isAiming ? (hasScope ? 30 : 60) : baseFov;
    (camera as THREE.PerspectiveCamera).fov = THREE.MathUtils.lerp((camera as THREE.PerspectiveCamera).fov, targetFov, 0.2);
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

    // Camera sway
    const t = three.clock.getElapsedTime();
    camera.rotation.x -= prevSwayX.current;
    camera.rotation.y -= prevSwayY.current;

    if (state.isAiming) {
      aimTime.current += delta;
      const baseIntensity = hasScope ? 0.002 : 0.0008;
      const maxIntensity = hasScope ? 0.015 : 0.005;
      const swayIntensity = baseIntensity + Math.min(aimTime.current * 0.002, maxIntensity - baseIntensity);
      const newSwayX = Math.sin(t * 1.5) * swayIntensity;
      const newSwayY = Math.cos(t * 1.2) * swayIntensity;
      camera.rotation.x += newSwayX;
      camera.rotation.y += newSwayY;
      prevSwayX.current = newSwayX;
      prevSwayY.current = newSwayY;
    } else {
      aimTime.current = 0;
      prevSwayX.current = 0;
      prevSwayY.current = 0;
    }

    // Screen shake decay is now merged into the stealth setState above
  });

  return null;
}

// ─── GPU tier auto-detect ─────────────────────────────────────────────────────
// Reads the WebGL renderer string to identify GPU family at startup.
// RTX 3050 → High | Any integrated / Intel UHD → Low | Unknown → Medium
function detectDefaultQuality(): 'Low' | 'Medium' | 'High' | 'Ultra' {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'Low'; // no WebGL at all → definitely iGPU or very old
    const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    if (!ext) return 'Medium';
    const renderer = ((gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) as string).toLowerCase();
    canvas.remove();
    // Integrated / software renderers
    if (
      renderer.includes('intel') ||
      renderer.includes('uhd') ||
      renderer.includes('hd graphics') ||
      renderer.includes('iris') ||
      renderer.includes('swiftshader') ||
      renderer.includes('llvmpipe') ||
      renderer.includes('mesa')
    ) return 'Low';
    // High-end discrete
    if (
      renderer.includes('rtx 30') || renderer.includes('rtx 40') ||
      renderer.includes('rx 6') || renderer.includes('rx 7') ||
      renderer.includes('rtx 20') ||
      renderer.includes('gtx 1080') || renderer.includes('gtx 1070')
    ) return 'High';
    // Mid-range discrete (RTX 3050, GTX 1060, etc.)
    if (
      renderer.includes('rtx') || renderer.includes('gtx') ||
      renderer.includes('radeon') || renderer.includes('amd')
    ) return 'Medium';
    return 'Medium';
  } catch {
    return 'Medium';
  }
}

const DEFAULT_QUALITY = detectDefaultQuality();

// --- Main App ---
export default function App() {
  const [state, setState] = useState<GameState>({
    health: 200, maxHealth: 200, medikits: 0,
    currentWeaponIndex: 0,
    weapons: [{ ...WEAPONS_DATA[WeaponType.KNIFE], attachments: [] }],
    availableAttachments: [],
    currentAct: 1, currentChapter: 1,
    isPaused: false, isGameOver: false,
    enemiesKilled: 0, totalEnemiesInLevel: CHAPTERS[0].enemyCount,
    gameStarted: false, showPrologue: false, showStory: true,
    isAiming: false, isReloading: false, isHealing: false,
    lastHitTime: 0, isLocked: false, isInventoryOpen: false,
    isCrouching: false, isInteracting: false,
    difficulty: Difficulty.STANDARD, isTestRun: false,
    showLoadGame: false, showWeaponStats: false, showSettings: false,
    showZoneCompletionPrompt: false, isZoneCompleted: false,
    // New gameplay state
    stealthLevel: 1, isRunning: false,
    damageDirection: 0, damageDirectionTime: 0,
    screenShake: 0, killStreak: 0, lastKillTime: 0,
    killFeedMessage: '', killFeedTime: 0,
    settings: {
      masterVolume: 80, musicVolume: 30, sfxVolume: 100,
      footstepVolume: 80, mouseSensitivity: 1.0,
      quality: DEFAULT_QUALITY, textureQuality: DEFAULT_QUALITY,
      shadows: DEFAULT_QUALITY !== 'Low',
      postProcessing: DEFAULT_QUALITY !== 'Low',
      renderScale: DEFAULT_QUALITY === 'Low' ? 0.6 : 1.0,
      showFps: false,
      fov: 75,
      particleDensity: 50,
      keybinds: {
        moveForward: 'KeyW', moveBackward: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
        sprint: 'ShiftLeft', crouch: 'KeyC', reload: 'KeyR', medikit: 'KeyQ',
        weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3',
        inventory: 'Tab', pause: 'Escape', shoot: 'Mouse0', aim: 'Mouse2', interact: 'KeyE'
      }
    }
  });

  const lastFireTime = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const tempDir = useRef(new THREE.Vector3());
  const [muzzleFlash, setMuzzleFlash] = useState(false);
  const [recoilKick, setRecoilKick] = useState(0);
  const [nearPickup, setNearPickup] = useState<string | null>(null);
  const [canLock, setCanLock] = useState(true);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const playerPos = useRef(new THREE.Vector3(0, 0, 0));
  const lastSoundTime = useRef(0);
  const enemies = useRef<any[]>([]);
  const medikits = useRef<any[]>([]);
  const ammoPickups = useRef<any[]>([]);
  const weaponPickups = useRef<any[]>([]);
  const attachmentPickups = useRef<any[]>([]);
  // Always-current mirror of state.weapons for use inside World refs
  const playerWeapons = useRef<any[]>(state.weapons);
  playerWeapons.current = state.weapons;

  // Cutscene state
  const [activeCutscene, setActiveCutscene] = useState<ReturnType<typeof getCutsceneForChapter>>(null);
  const cutsceneShownFor = useRef<Set<number>>(new Set());

  const currentChapter = CHAPTERS.find(c => c.id === state.currentChapter);
  const terrainType = getTerrainType(currentChapter?.location || "");

  const { triggerBossDefeat } = useMusicEngine(state);

  useEffect(() => {
    if (state.isZoneCompleted && (currentChapter?.isBoss || (currentChapter as any)?.isMinisBoss)) {
      triggerBossDefeat();
    }
  }, [state.isZoneCompleted, currentChapter, triggerBossDefeat]);

  // DPR driven directly by renderScale setting (set by preset or manual slider)
  const getDpr = (): [number, number] => {
    const s = state.settings.renderScale;
    return [s, s];
  };

  const getEnemyCountForDifficulty = (baseCount: number, difficulty: Difficulty) => {
    if (baseCount === 0) return 0;
    if (difficulty === Difficulty.HARDCORE) return baseCount + 3 + Math.floor(Math.random() * 3);
    return baseCount;
  };

  const nextChapter = () => {
    const nextId = state.currentChapter + 1;
    const nextChap = CHAPTERS.find(c => c.id === nextId);
    if (!nextChap) return; // no more chapters

    setState(prev => {
      const newState = {
        ...prev, currentChapter: nextId, currentAct: nextChap.act,
        enemiesKilled: 0, totalEnemiesInLevel: getEnemyCountForDifficulty(nextChap.enemyCount, prev.difficulty),
        showStory: true, showZoneCompletionPrompt: false, isZoneCompleted: false,
        killStreak: 0,
      };
      // Auto-save on chapter transition
      const saves = JSON.parse(localStorage.getItem('primal_fracture_saves') || '[]');
      const newSave = { timestamp: Date.now(), chapter: nextId, state: {
        health: newState.health, maxHealth: newState.maxHealth, medikits: newState.medikits,
        weapons: newState.weapons, availableAttachments: newState.availableAttachments,
        currentAct: newState.currentAct, currentChapter: newState.currentChapter,
        difficulty: newState.difficulty, settings: newState.settings, totalEnemiesInLevel: newState.totalEnemiesInLevel
      }};
      localStorage.setItem('primal_fracture_saves', JSON.stringify([newSave, ...saves].slice(0, 10)));
      return newState;
    });
  };

  const saveGame = () => {
    const save = { timestamp: Date.now(), chapter: state.currentChapter, state: {
      health: state.health, maxHealth: state.maxHealth, medikits: state.medikits,
      weapons: state.weapons, availableAttachments: state.availableAttachments,
      currentAct: state.currentAct, currentChapter: state.currentChapter,
      difficulty: state.difficulty, settings: state.settings, totalEnemiesInLevel: state.totalEnemiesInLevel
    }};
    localStorage.setItem('primal_fracture_save_folder', JSON.stringify(save));
    alert("Game Saved!");
  };

  const handleEnemyKilled = () => {
    setState(prev => {
      const killed = prev.enemiesKilled + 1;
      const now = Date.now();
      const timeSinceLastKill = now - prev.lastKillTime;
      const streak = timeSinceLastKill < 5000 ? prev.killStreak + 1 : 1;
      
      let message = 'HOSTILE ELIMINATED';
      if (streak === 2) message = 'DOUBLE KILL!';
      else if (streak === 3) message = 'TRIPLE KILL!';
      else if (streak >= 4) message = 'KILLING SPREE!';
      
      if (streak > 1) {
        playKillStreakSound(streak, prev.settings.sfxVolume, prev.settings.masterVolume);
      }

      if (killed >= prev.totalEnemiesInLevel) {
        return { ...prev, enemiesKilled: killed, showZoneCompletionPrompt: true, isZoneCompleted: true,
          killStreak: streak, lastKillTime: now, killFeedMessage: message, killFeedTime: now };
      }
      return { ...prev, enemiesKilled: killed, killStreak: streak, lastKillTime: now,
        killFeedMessage: message, killFeedTime: now };
    });
  };

  const handleEnemyHit = () => {
    setState(prev => ({ ...prev, lastHitTime: Date.now() }));
  };

  const handleShoot = () => {
    if (!cameraRef.current) return;
    const now = Date.now();
    const currentState = stateRef.current;
    if (currentState.weapons.length === 0) return;
    const weapon = currentState.weapons[currentState.currentWeaponIndex];
    const isKnife = weapon.type === WeaponType.KNIFE;
    
    if (now - lastFireTime.current < weapon.fireRate * 1000) return;
    if (currentState.isReloading || currentState.isHealing || currentState.isPaused || currentState.isGameOver || currentState.showStory || currentState.isInventoryOpen) return;

    if (!isKnife && weapon.ammo <= 0) {
      if (weapon.reserve > 0) handleReload();
      return;
    }

    lastFireTime.current = now;
    const isSilenced = weapon.attachments.includes(AttachmentType.SILENCER) || isKnife;
    if (!isSilenced) lastSoundTime.current = now;
    playFireSound(weapon.type, isSilenced, currentState.settings.sfxVolume, currentState.settings.masterVolume);
    
    if (!isKnife) {
      setMuzzleFlash(true);
      setTimeout(() => setMuzzleFlash(false), 50);
      
      // Recoil kick
      const hasRecoilCtrl = weapon.attachments.includes(AttachmentType.RECOIL_CONTROLLER);
      const kickAmount = hasRecoilCtrl ? 0.3 : 1.0;
      setRecoilKick(kickAmount);
      setTimeout(() => setRecoilKick(0), 100);
      
      // Shell eject & muzzle smoke particles
      if (cameraRef.current) {
        const pos = cameraRef.current.position;
        window.dispatchEvent(new CustomEvent('shell-eject', { detail: { position: [pos.x + 0.3, pos.y - 0.2, pos.z] } }));
        
        const dir = new THREE.Vector3();
        cameraRef.current.getWorldDirection(dir);
        window.dispatchEvent(new CustomEvent('muzzle-smoke', { detail: { position: [pos.x + dir.x * 0.5, pos.y + dir.y * 0.5, pos.z + dir.z * 0.5] } }));
      }
    }

    // Hit detection
    const cameraPos = cameraRef.current.position;
    const cameraDir = tempDir.current;
    cameraRef.current.getWorldDirection(cameraDir);

    const maxDist = weapon.range;
    const hitRadius = isKnife ? 1.5 : 0.8;
    let closestEnemy: any = null;
    let closestDist = Infinity;

    enemies.current.forEach(enemy => {
      if (!enemy || !enemy.position) return;
      const ex = enemy.position[0], ey = enemy.position[1] + 1.2, ez = enemy.position[2];
      const dx = ex - cameraPos.x, dy = ey - cameraPos.y, dz = ez - cameraPos.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist > maxDist) return;

      const dot = dx * cameraDir.x + dy * cameraDir.y + dz * cameraDir.z;
      if (dot <= 0) return;
      
      const crossX = dy * cameraDir.z - dz * cameraDir.y;
      const crossY = dz * cameraDir.x - dx * cameraDir.z;
      const crossZ = dx * cameraDir.y - dy * cameraDir.x;
      const perpDist = Math.sqrt(crossX*crossX + crossY*crossY + crossZ*crossZ);

      if (perpDist < hitRadius && dist < closestDist) {
        closestEnemy = enemy;
        closestDist = dist;
      }
    });

    if (closestEnemy) {
      // Stealth bonus: crouching + knife = 2x damage
      const stealthMultiplier = (isKnife && currentState.isCrouching) ? 2.0 : 1.0;
      window.dispatchEvent(new CustomEvent('enemy-hit', { detail: { id: closestEnemy.id, damage: weapon.damage * stealthMultiplier } }));
    }

    if (!isKnife) {
      setState(prev => {
        const newWeapons = [...prev.weapons];
        newWeapons[prev.currentWeaponIndex] = { ...newWeapons[prev.currentWeaponIndex], ammo: newWeapons[prev.currentWeaponIndex].ammo - 1 };
        return { ...prev, weapons: newWeapons };
      });
    }
  };

  const handleReload = () => {
    const s = stateRef.current;
    const weapon = s.weapons[s.currentWeaponIndex];
    if (!weapon || weapon.type === WeaponType.KNIFE || weapon.reserve <= 0 || weapon.ammo >= weapon.maxAmmo || s.isReloading || s.isPaused || s.isGameOver || s.showStory) return;
    
    playReloadSound(s.settings.sfxVolume, s.settings.masterVolume);
    setState(prev => ({ ...prev, isReloading: true }));
    
    setTimeout(() => {
      setState(prev => {
        if (!prev.isReloading) return prev; // was cancelled
        const newWeapons = [...prev.weapons];
        const w = { ...newWeapons[prev.currentWeaponIndex] };
        const needed = w.maxAmmo - w.ammo;
        const loaded = Math.min(needed, w.reserve);
        w.ammo += loaded;
        w.reserve -= loaded;
        newWeapons[prev.currentWeaponIndex] = w;
        return { ...prev, weapons: newWeapons, isReloading: false };
      });
    }, weapon.reloadTime * 1000);
  };

  const handleMedikit = () => {
    const s = stateRef.current;
    if (s.medikits <= 0 || s.health >= s.maxHealth || s.isHealing || s.isPaused || s.isGameOver) return;
    playMedikitSound(s.settings.sfxVolume, s.settings.masterVolume);
    setState(prev => ({ ...prev, isHealing: true }));
    setTimeout(() => {
      setState(prev => {
        if (!prev.isHealing) return prev; // already cancelled
        return { ...prev, health: Math.min(prev.maxHealth, prev.health + 199), medikits: prev.medikits - 1, isHealing: false };
      });
    }, 1000);
  };

  const handlePlayerHit = (enemyPos: [number, number, number], weaponType: WeaponType) => {
    playHitSound(state.settings.sfxVolume, state.settings.masterVolume);

    // Calculate damage direction
    const dx = enemyPos[0] - playerPos.current.x;
    const dz = enemyPos[2] - playerPos.current.z;
    const angle = Math.atan2(dx, dz);
    
    const weaponDamage = WEAPONS_DATA[weaponType]?.damage || 15;
    const dmg = Math.floor(weaponDamage * (0.3 + Math.random() * 0.4));
    setState(prev => {
      const newHealth = prev.health - dmg;
      if (newHealth <= 0) return { ...prev, health: 0, isGameOver: true };
      return { ...prev, health: newHealth, damageDirection: angle, damageDirectionTime: Date.now(), screenShake: 1.0 };
    });
  };

  // Input handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.gameStarted) return;

      // ── Pause / Escape — always works ──
      if (e.code === s.settings.keybinds.pause) {
        if (s.isInventoryOpen) { setState(prev => ({ ...prev, isInventoryOpen: false })); return; }
        setState(prev => ({ ...prev, isPaused: !prev.isPaused, showLoadGame: false, showWeaponStats: false, showSettings: false }));
        return;
      }
      // ── Inventory toggle — only during gameplay ──
      if (e.code === s.settings.keybinds.inventory && !s.isPaused && !s.isGameOver && !s.showStory && !s.showPrologue) {
        setState(prev => ({ ...prev, isInventoryOpen: !prev.isInventoryOpen }));
        return;
      }

      // Block ALL other inputs when not in active gameplay
      if (s.isPaused || s.isGameOver || s.showStory || s.showPrologue || s.isInventoryOpen) return;

      // ── Gameplay actions ──
      if (e.code === s.settings.keybinds.reload) handleReload();
      if (e.code === s.settings.keybinds.medikit) handleMedikit();
      if (e.code === s.settings.keybinds.interact) {
        setState(prev => ({ ...prev, isInteracting: true }));
        setTimeout(() => setState(prev => ({ ...prev, isInteracting: false })), 200);
      }

      // Weapon switching (1/2/3 keys)
      const weaponKeys = [s.settings.keybinds.weapon1, s.settings.keybinds.weapon2, s.settings.keybinds.weapon3];
      const idx = weaponKeys.indexOf(e.code);
      if (idx !== -1 && idx < s.weapons.length && !s.isReloading) {
        setState(prev => ({ ...prev, currentWeaponIndex: idx }));
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const s = stateRef.current;
      if (!s.gameStarted || s.isPaused || s.isGameOver || s.showStory || s.isInventoryOpen) return;
      
      if (e.button === 0) handleShoot();
      if (e.button === 2) setState(prev => ({ ...prev, isAiming: true }));
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) setState(prev => ({ ...prev, isAiming: false }));
    };

    const handleWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      if (!s.gameStarted || s.isPaused || s.isGameOver || s.showStory || s.isInventoryOpen || s.isReloading) return;
      e.preventDefault();
      setState(prev => {
        if (prev.weapons.length <= 1) return prev;
        const dir = e.deltaY > 0 ? 1 : -1;
        const next = (prev.currentWeaponIndex + dir + prev.weapons.length) % prev.weapons.length;
        return { ...prev, currentWeaponIndex: next };
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handleStart = () => {
    initAudio();
    setState(prev => ({ ...prev, gameStarted: true, showPrologue: true }));
  };

  const handleTestRun = () => {
    initAudio();
    setState(prev => ({
      ...prev, isTestRun: true, gameStarted: true, showPrologue: false, showStory: true,
      weapons: Object.values(WEAPONS_DATA).map(w => ({ ...w, reserve: 999, ammo: w.maxAmmo, attachments: [AttachmentType.SCOPE, AttachmentType.SILENCER, AttachmentType.EXTENDED_MAG] })),
      health: 200, maxHealth: 200, medikits: 10,
      availableAttachments: [AttachmentType.SCOPE, AttachmentType.SILENCER, AttachmentType.EXTENDED_MAG, AttachmentType.RECOIL_CONTROLLER]
    }));
  };

  const handleRestart = () => {
    setState(prev => ({
      ...prev, health: 200, maxHealth: 200, medikits: 0, isGameOver: false,
      enemiesKilled: 0, isPaused: false, showStory: true,
      currentWeaponIndex: 0, weapons: [{ ...WEAPONS_DATA[WeaponType.KNIFE], attachments: [] }],
      availableAttachments: [], currentAct: 1, currentChapter: 1,
      totalEnemiesInLevel: CHAPTERS[0].enemyCount, isTestRun: false,
      killStreak: 0, killFeedMessage: '', screenShake: 0,
    }));
  };

  const handleReturnToMenu = () => {
    setState(prev => ({
      ...prev, gameStarted: false, isPaused: false, isGameOver: false,
      health: 200, maxHealth: 200, medikits: 0,
      currentWeaponIndex: 0, weapons: [{ ...WEAPONS_DATA[WeaponType.KNIFE], attachments: [] }],
      availableAttachments: [], currentAct: 1, currentChapter: 1,
      enemiesKilled: 0, totalEnemiesInLevel: CHAPTERS[0].enemyCount,
      isTestRun: false, killStreak: 0, killFeedMessage: '', screenShake: 0,
    }));
  };

  // --- Not started: Main Menu ---
  if (!state.gameStarted) {
    return <MainMenu onStart={handleStart} state={state} dispatch={setState} onTestRun={handleTestRun} />;
  }

  const chapter = CHAPTERS.find(c => c.id === state.currentChapter);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden relative">
      {/* 3D Canvas */}
      <Canvas
        shadows={state.settings.shadows}
        dpr={getDpr()}
        frameloop={state.isPaused || state.showStory || state.showPrologue || state.isInventoryOpen ? 'demand' : 'always'}
        camera={{ fov: state.settings.fov, near: 0.1, far: 500, position: state.currentChapter === 1 ? [BOAT_SPAWN_POSITION[0], BOAT_SPAWN_POSITION[1] + 1.1, BOAT_SPAWN_POSITION[2]] : [0, 1.7, 0] }}
        gl={{
          antialias: state.settings.quality === 'Ultra',
          powerPreference: 'high-performance',
          precision: state.settings.quality === 'Low' ? 'mediump' : 'highp',
          stencil: false,
          depth: true,
          alpha: false,
        }}
      >
        <PointerLockControls 
          onLock={() => { initAudio(); setState(prev => ({ ...prev, isLocked: true })); }}
          onUnlock={() => { setState(prev => ({ ...prev, isLocked: false })); setCanLock(false); setTimeout(() => setCanLock(true), 2000); }}
        />
        
        <PlayerTracker 
          terrainType={terrainType}
          sfxVolume={state.settings.sfxVolume}
          masterVolume={state.settings.masterVolume}
          footstepVolume={state.settings.footstepVolume}
          mouseSensitivity={state.settings.mouseSensitivity}
          baseFov={state.settings.fov}
          state={state} setState={setState}
          cameraRef={cameraRef} playerPos={playerPos}
        />

        <WeaponViewModel
          weapon={state.weapons[state.currentWeaponIndex]}
          isAiming={state.isAiming}
          muzzleFlash={muzzleFlash}
          isReloading={state.isReloading}
          isHealing={state.isHealing}
          recoilKick={recoilKick}
        />

        <World
          chapter={state.currentChapter}
          onEnemyKilled={handleEnemyKilled}
          onPlayerHit={handlePlayerHit}
          onEnemyHit={handleEnemyHit}
          onMedikitPickup={() => setState(prev => ({ ...prev, medikits: prev.medikits + 1 }))}
          onAmmoPickup={(type, amount) => {
            setState(prev => {
              const newWeapons = prev.weapons.map(w => w.type === type ? { ...w, reserve: w.reserve + amount } : w);
              return { ...prev, weapons: newWeapons };
            });
          }}
          onWeaponPickup={(type) => {
            setState(prev => {
              if (prev.weapons.find(w => w.type === type)) {
                const newWeapons = prev.weapons.map(w => w.type === type ? { ...w, reserve: w.reserve + w.maxAmmo } : w);
                return { ...prev, weapons: newWeapons };
              }
              return { ...prev, weapons: [...prev.weapons, { ...WEAPONS_DATA[type], attachments: [] }] };
            });
          }}
          onAttachmentPickup={(type) => {
            setState(prev => {
              if (!prev.availableAttachments.includes(type)) {
                return { ...prev, availableAttachments: [...prev.availableAttachments, type] };
              }
              return prev;
            });
          }}
          playerPos={playerPos}
          lastSoundTime={lastSoundTime}
          sfxVolume={state.settings.sfxVolume}
          masterVolume={state.settings.masterVolume}
          enemies={enemies}
          medikits={medikits}
          ammoPickups={ammoPickups}
          weaponPickups={weaponPickups}
          attachmentPickups={attachmentPickups}
          isInteracting={state.isInteracting}
          setNearPickup={setNearPickup}
          quality={state.settings.quality}
          playerStealthLevel={state.stealthLevel}
          difficulty={state.difficulty}
          playerWeapons={playerWeapons}
        />

        {/* Particle Systems */}
        <BloodParticles quality={state.settings.quality} density={state.settings.particleDensity} />
        <ShellParticles quality={state.settings.quality} density={state.settings.particleDensity} />
        <MuzzleSmokeParticles quality={state.settings.quality} density={state.settings.particleDensity} />

        {/* Post-Processing — skipped entirely if disabled in settings or on Low quality */}
        <PostProcessing
          quality={state.settings.quality}
          isAiming={state.isAiming}
          enabled={state.settings.postProcessing}
        />
      </Canvas>

      {/* UI Overlays */}
      <AnimatePresence>
        {state.showPrologue && (
          <PrologueScreen onContinue={() => setState(prev => ({ ...prev, showPrologue: false, showStory: true }))} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.showStory && !state.showPrologue && chapter && (() => {
          // Check if this chapter has a cutscene we haven't shown yet
          const cutscene = getCutsceneForChapter(chapter.id);
          const shouldShowCutscene = cutscene && !cutsceneShownFor.current.has(chapter.id);

          if (shouldShowCutscene && !activeCutscene) {
            // Trigger the cutscene (set it on next tick to avoid render issues)
            setTimeout(() => {
              cutsceneShownFor.current.add(chapter.id);
              setActiveCutscene(cutscene);
            }, 0);
          }

          if (activeCutscene) {
            return (
              <CutsceneOverlay
                cutscene={activeCutscene}
                onComplete={() => {
                  const skip = activeCutscene.skipToChapter;
                  setActiveCutscene(null);
                  if (skip) {
                    const nextChap = CHAPTERS.find(c => c.id === skip);
                    ammoPickups.current = [];
                    weaponPickups.current = []; // Weapons now drop from enemies only
                    attachmentPickups.current = [];
                    if (nextChap) {
                      setState(prev => ({
                        ...prev,
                        currentChapter: skip,
                        currentAct: nextChap.act,
                        enemiesKilled: 0,
                        totalEnemiesInLevel: getEnemyCountForDifficulty(nextChap.enemyCount, prev.difficulty),
                        isZoneCompleted: false,
                        showZoneCompletionPrompt: false,
                        killStreak: 0,
                        showStory: true,
                      }));
                    }
                  }
                }}
              />
            );
          }

          return (
            <StoryScreen chapter={chapter} onContinue={() => {
              setState(prev => ({ ...prev, showStory: false }));
              setTimeout(() => { if (canLock && document.pointerLockElement === null) { try { document.body.requestPointerLock(); } catch {} }}, 500);
            }} />
          );
        })()}
      </AnimatePresence>

      {!state.showPrologue && !state.showStory && !state.isPaused && !state.isGameOver && state.isLocked && (
        <HUD state={state} playerPos={playerPos} enemies={enemies} medikits={medikits} weaponPickups={weaponPickups} ammoPickups={ammoPickups} nearPickup={nearPickup} showFpsOverride={state.settings.showFps} />
      )}

      {/* Click to Resume overlay */}
      {!state.isLocked && !state.isPaused && !state.showStory && !state.showPrologue && !state.isGameOver && !state.isInventoryOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center cursor-pointer"
          onClick={() => { if (canLock) { try { document.body.requestPointerLock(); } catch {} }}}>
          <div className="text-white text-2xl font-black uppercase tracking-widest animate-pulse">Click to Resume</div>
        </div>
      )}

      {/* Zone Completion Prompt */}
      <AnimatePresence>
        {state.showZoneCompletionPrompt && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center pointer-events-none">
            <div className="bg-black/80 backdrop-blur-md border border-green-500/30 p-8 rounded-xl text-center space-y-4 pointer-events-auto">
              <div className="text-green-400 text-[10px] font-black uppercase tracking-widest">Zone Secured</div>
              <h2 className="text-4xl font-black text-white uppercase italic">All Hostiles Eliminated</h2>
              <div className="flex gap-4 justify-center">
                <button onClick={nextChapter}
                  className="px-8 py-3 bg-green-600 text-white font-black uppercase tracking-widest rounded-sm hover:bg-green-500 transition-colors flex items-center gap-2">
                  Next Zone <ChevronRight className="w-5 h-5" />
                </button>
                <button onClick={saveGame}
                  className="px-8 py-3 bg-white/10 text-white font-black uppercase tracking-widest rounded-sm hover:bg-white/20 transition-colors border border-white/20">
                  Save Progress
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Inventory */}
      <AnimatePresence>
        {state.isInventoryOpen && <InventoryScreen state={state} dispatch={setState} />}
      </AnimatePresence>

      {/* Pause Menu */}
      {state.isPaused && !state.showLoadGame && !state.showWeaponStats && !state.showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center">
          <div className="text-center space-y-8">
            <h2 className="text-6xl font-black text-white italic uppercase tracking-tighter">Paused</h2>
            <div className="flex flex-col gap-3 w-64">
              <button onClick={() => setState(prev => ({ ...prev, isPaused: false }))}
                className="p-4 bg-white text-black font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors">Resume</button>
              <button onClick={saveGame}
                className="p-4 bg-white/10 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/10">Save Game</button>
              <button onClick={() => setState(prev => ({ ...prev, showLoadGame: true }))}
                className="p-4 bg-white/10 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/10">Load Game</button>
              <button onClick={() => setState(prev => ({ ...prev, showWeaponStats: true }))}
                className="p-4 bg-white/10 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/10">Weapons</button>
              <button onClick={() => setState(prev => ({ ...prev, showSettings: true }))}
                className="p-4 bg-white/10 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/10">Settings</button>
              <button onClick={handleReturnToMenu}
                className="p-4 bg-red-600/20 text-red-500 font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-colors border border-red-500/20">Main Menu</button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Sub-Screens */}
      {state.isPaused && state.showLoadGame && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center">
          <LoadGameScreen state={state} dispatch={setState} />
        </div>
      )}
      {state.isPaused && state.showWeaponStats && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center">
          <WeaponStatsScreen state={state} dispatch={setState} />
        </div>
      )}
      {state.isPaused && state.showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center">
          <SettingsMenu state={state} dispatch={setState} onBack={() => setState(prev => ({ ...prev, showSettings: false }))} />
        </div>
      )}

      {/* Game Over */}
      {state.isGameOver && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center">
          <div className="text-center space-y-8">
            <h2 className="text-8xl font-black text-red-500 italic uppercase tracking-tighter">Mission Failed</h2>
            <p className="text-white/60 uppercase tracking-widest font-bold">Marcus Vael has fallen.</p>
            <div className="flex gap-4 justify-center">
              <button onClick={handleRestart}
                className="px-8 py-4 bg-white text-black font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors flex items-center gap-2">
                <RefreshCcw className="w-5 h-5" /> Restart Mission
              </button>
              <button onClick={handleReturnToMenu}
                className="px-8 py-4 bg-white/10 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-colors border border-white/20">
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
