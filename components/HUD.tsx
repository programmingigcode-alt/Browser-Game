import React, { useRef, useEffect, useState } from 'react';
import { Heart, Shield, Crosshair, Skull, Eye, MapPin } from 'lucide-react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, WeaponType } from '@/types';
import { CHAPTERS, WEAPONS_DATA, ATTACHMENTS_DATA } from '@/constants';

// ─── FPS Counter ────────────────────────────────────────────────────
const FpsCounter = ({ quality }: { quality: string }) => {
  const fpsRef = useRef<HTMLDivElement>(null);
  const frames = useRef<number[]>([]);
  const rafId = useRef<number>(0);

  useEffect(() => {
    const tick = (now: number) => {
      frames.current.push(now);
      // Keep only the last 60 timestamps
      while (frames.current.length > 0 && now - frames.current[0] > 1000)
        frames.current.shift();
      const fps = frames.current.length;
      if (fpsRef.current) {
        fpsRef.current.textContent = `${fps} FPS`;
        fpsRef.current.style.color =
          fps >= 50 ? '#4ade80' : fps >= 30 ? '#facc15' : '#f87171';
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div ref={fpsRef} className="text-xs font-black tabular-nums" />
      <div className="text-[9px] text-white/30 uppercase tracking-widest font-bold">{quality}</div>
    </div>
  );
};

const Minimap = ({ playerPos, enemies, medikits, weaponPickups, ammoPickups, objectivePos }: { 
  playerPos: React.MutableRefObject<THREE.Vector3>, 
  enemies: React.MutableRefObject<any[]>, 
  medikits: React.MutableRefObject<any[]>,
  weaponPickups: React.MutableRefObject<any[]>,
  ammoPickups: React.MutableRefObject<any[]>,
  objectivePos?: [number, number] | null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameSkip = useRef(0);
  const coordRef = useRef<HTMLSpanElement>(null);

  // Live coordinate ticker — separate RAF so it never misses a frame
  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (coordRef.current) {
        const x = playerPos.current.x.toFixed(1);
        const z = playerPos.current.z.toFixed(1);
        coordRef.current.textContent = `X ${x}  Z ${z}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let animationFrame: number;
    const update = () => {
      frameSkip.current++;
      if (frameSkip.current % 2 !== 0) { animationFrame = requestAnimationFrame(update); return; }
      
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          const W = 160, H = 160, cx = W/2, cy = H/2;
          ctx.clearRect(0, 0, W, H);
          
          // Background
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(0, 0, W, H);

          // Compass ring
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx, cy, 72, 0, Math.PI * 2); ctx.stroke();
          
          // Grid
          const scale = 1.2;
          const gridSize = 30;
          const offsetX = (playerPos.current.x * scale) % gridSize;
          const offsetZ = (playerPos.current.z * scale) % gridSize;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
          for (let i = -gridSize * 3; i <= W + gridSize * 3; i += gridSize) {
            const x = cx + i - offsetX;
            if (x >= 0 && x <= W) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
            const y = cy + i - offsetZ;
            if (y >= 0 && y <= H) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
          }

          // Cardinal labels
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.font = '8px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('N', cx, 12);
          ctx.fillText('S', cx, H - 5);
          ctx.fillText('W', 8, cy + 3);
          ctx.fillText('E', W - 8, cy + 3);

          // Border
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.lineWidth = 1;
          ctx.strokeRect(0, 0, W, H);

          // Helper: clamp to minimap bounds
          const inBounds = (x: number, y: number) => x > 5 && x < W-5 && y > 5 && y < H-5;

          // ── Medikits (green +) ──
          medikits.current.forEach(obj => {
            if (!obj?.position) return;
            const x = cx + (obj.position[0] - playerPos.current.x) * scale;
            const y = cy + (obj.position[2] - playerPos.current.z) * scale;
            if (!inBounds(x, y)) return;
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); ctx.stroke();
          });

          // ── Weapon pickups (yellow diamond) ──
          weaponPickups.current.forEach(obj => {
            if (!obj?.position) return;
            const x = cx + (obj.position[0] - playerPos.current.x) * scale;
            const y = cy + (obj.position[2] - playerPos.current.z) * scale;
            if (!inBounds(x, y)) return;
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(x, y - 4); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 3, y);
            ctx.closePath(); ctx.fill();
          });

          // ── Ammo pickups (orange circle) ──
          ammoPickups.current.forEach(obj => {
            if (!obj?.position) return;
            const x = cx + (obj.position[0] - playerPos.current.x) * scale;
            const y = cy + (obj.position[2] - playerPos.current.z) * scale;
            if (!inBounds(x, y)) return;
            ctx.fillStyle = '#fb923c';
            ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
          });

          // ── Enemies (red triangle — skip dead ones) ──
          ctx.fillStyle = '#ef4444';
          enemies.current.forEach(enemy => {
            if (!enemy?.position || enemy.isDead) return;
            const x = cx + (enemy.position[0] - playerPos.current.x) * scale;
            const y = cy + (enemy.position[2] - playerPos.current.z) * scale;
            if (!inBounds(x, y)) return;
            ctx.beginPath();
            ctx.moveTo(x, y - 3.5); ctx.lineTo(x + 3, y + 2.5); ctx.lineTo(x - 3, y + 2.5);
            ctx.closePath(); ctx.fill();
          });

          // ── Objective marker (pulsing cyan diamond) ──
          if (objectivePos) {
            const ox = cx + (objectivePos[0] - playerPos.current.x) * scale;
            const oy = cy + (objectivePos[1] - playerPos.current.z) * scale;
            if (inBounds(ox, oy)) {
              const pulse = 4 + Math.sin(Date.now() * 0.005) * 1.5;
              ctx.fillStyle = '#22d3ee';
              ctx.beginPath();
              ctx.moveTo(ox, oy - pulse); ctx.lineTo(ox + pulse * 0.7, oy); ctx.lineTo(ox, oy + pulse); ctx.lineTo(ox - pulse * 0.7, oy);
              ctx.closePath(); ctx.fill();
              ctx.strokeStyle = 'rgba(34,211,238,0.4)';
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.arc(ox, oy, pulse + 3, 0, Math.PI * 2); ctx.stroke();
            }
          }

          // ── Player (blue dot with white ring) ──
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      animationFrame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="border border-white/10 bg-black/40 backdrop-blur-md p-1 rounded-sm overflow-hidden relative">
      <canvas ref={canvasRef} width={160} height={160} className="block" />
      {/* Coordinates */}
      <div className="px-1 py-0.5 bg-black/60 flex items-center justify-center gap-1"
           style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0">
          <circle cx="4" cy="4" r="3" fill="#3b82f6" opacity="0.9" />
        </svg>
        <span ref={coordRef} className="font-mono text-[9px] font-bold tracking-wider"
              style={{ color: 'rgba(255,255,255,0.55)' }}>X 0.0  Z 0.0</span>
      </div>
      {/* Legend */}
      <div className="px-1 pt-0.5 pb-0.5 flex items-center gap-2 text-[7px] font-bold uppercase tracking-wider text-white/30">
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 bg-red-500 inline-block" style={{clipPath:'polygon(50% 0,100% 100%, 0 100%)'}} />Foe</span>
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 bg-green-500 inline-block" />Med</span>
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 bg-yellow-400 inline-block rotate-45" />Gun</span>
        <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 bg-orange-400 rounded-full inline-block" />Ammo</span>
      </div>
    </div>
  );
};

const HUD = React.memo(({ state, playerPos, enemies, medikits, weaponPickups, ammoPickups, nearPickup, showFpsOverride }: {
  state: GameState, 
  playerPos: React.MutableRefObject<THREE.Vector3>,
  enemies: React.MutableRefObject<any[]>,
  medikits: React.MutableRefObject<any[]>,
  weaponPickups: React.MutableRefObject<any[]>,
  ammoPickups: React.MutableRefObject<any[]>,
  nearPickup: string | null,
  showFpsOverride?: boolean,
}) => {
  const [showFpsLocal, setShowFpsLocal] = useState(false);
  const showFps = showFpsOverride || showFpsLocal;

  // F3 toggles FPS counter locally (in addition to Settings toggle)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'F3') { e.preventDefault(); setShowFpsLocal(p => !p); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const currentWeapon = state.weapons[state.currentWeaponIndex];
  const otherWeapons = state.weapons.filter((_, idx) => idx !== state.currentWeaponIndex);
  const chapter = CHAPTERS.find(c => c.id === state.currentChapter);

  // Dynamic crosshair spread
  const isMoving = state.isRunning;
  const crosshairSpread = state.isAiming ? 2 : (isMoving ? 16 : (state.isCrouching ? 4 : 8));
  
  // Damage direction indicator
  const showDamageDir = Date.now() - state.damageDirectionTime < 500;
  const damageAngle = state.damageDirection;
  
  // Kill feed
  const showKillFeed = Date.now() - state.killFeedTime < 2000;

  return (
    <div className="fixed inset-0 pointer-events-none flex flex-col justify-between p-8 z-50">
      {/* Screen Shake Effect (CSS) */}
      {state.screenShake > 0 && (
        <style>{`
          canvas { 
            transform: translate(${(Math.random() - 0.5) * state.screenShake * 10}px, ${(Math.random() - 0.5) * state.screenShake * 10}px) !important;
          }
        `}</style>
      )}

      {/* Damage Direction Indicator */}
      <AnimatePresence>
        {showDamageDir && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(circle at ${50 + Math.sin(damageAngle) * 40}% ${50 - Math.cos(damageAngle) * 40}%, rgba(255,0,0,0.4) 0%, transparent 40%)`,
            }}
          />
        )}
      </AnimatePresence>

      {/* Low Health Vignette */}
      {state.health < 50 && (
        <div 
          className="fixed inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle, transparent 40%, rgba(255,0,0,${(50 - state.health) / 100}) 100%)`,
            animation: state.health < 25 ? 'pulse 1s infinite' : 'none',
          }}
        />
      )}

      {/* Kill Feed */}
      <AnimatePresence>
        {showKillFeed && state.killFeedMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -30, scale: 0.6 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', damping: 12, stiffness: 200 }}
            className="fixed top-1/3 left-1/2 -translate-x-1/2 pointer-events-none z-50"
          >
            <div className="text-center">
              <div className="font-display text-red-500 text-5xl tracking-wider kill-glow drop-shadow-[0_0_30px_rgba(255,0,0,0.6)]"
                   style={{ letterSpacing: '0.15em' }}>
                {state.killFeedMessage}
              </div>
              {state.killStreak > 1 && (
                <div className="streak-text font-display text-3xl tracking-widest mt-2">
                  {state.killStreak}× STREAK
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interaction Prompt */}
      <AnimatePresence>
        {nearPickup && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 translate-y-24 flex flex-col items-center gap-2 pointer-events-none"
          >
            <div className="px-6 py-2 bg-black/80 backdrop-blur-md text-white text-xl font-black rounded-sm border border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.1)] uppercase italic tracking-tighter">
              Press [{state.settings.keybinds.interact.replace('Key', '')}] to Pickup {nearPickup}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed top-8 right-8 flex flex-col gap-4 z-50 pointer-events-auto">
        <Minimap playerPos={playerPos} enemies={enemies} medikits={medikits} weaponPickups={weaponPickups} ammoPickups={ammoPickups} objectivePos={chapter?.objectivePosition || null} />
        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-2 rounded-xl text-right">
          <div className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Location</div>
          <div className="text-sm font-black text-white">{chapter?.location}</div>
          <div className="text-[10px] text-white/60">{chapter?.title}</div>
        </div>
        {/* Stealth Indicator */}
        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-2 rounded-xl flex items-center gap-2">
          <Eye className={`w-4 h-4 ${state.stealthLevel < 0.5 ? 'text-green-400' : state.stealthLevel < 0.8 ? 'text-yellow-400' : 'text-red-400'}`} />
          <div className="flex-1">
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${state.stealthLevel < 0.5 ? 'bg-green-400' : state.stealthLevel < 0.8 ? 'bg-yellow-400' : 'bg-red-400'}`}
                style={{ width: `${state.stealthLevel * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Top Bar - Objectives */}
      <div className="flex justify-start items-start pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-xl pointer-events-auto">
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2">Objectives</div>
          {chapter?.enemyCount && chapter.enemyCount > 0 ? (
            <div className="flex items-center gap-3 text-white">
              <Skull className="w-4 h-4 text-red-500" />
              <span className="font-bold">Eliminate Hostiles: {state.enemiesKilled} / {state.totalEnemiesInLevel}</span>
            </div>
          ) : chapter?.objectiveLabel ? (
            <div className="flex items-center gap-3 text-white">
              <MapPin className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span className="font-bold">{chapter.objectiveLabel}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-white/50">
              <span className="font-bold">Explore the area</span>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Crosshair */}
      {currentWeapon && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="absolute h-px bg-white/50" style={{ width: 8, left: -(crosshairSpread + 8), top: '50%' }} />
            <div className="absolute h-px bg-white/50" style={{ width: 8, right: -(crosshairSpread + 8), top: '50%' }} />
            <div className="absolute w-px bg-white/50" style={{ height: 8, top: -(crosshairSpread + 8), left: '50%' }} />
            <div className="absolute w-px bg-white/50" style={{ height: 8, bottom: -(crosshairSpread + 8), left: '50%' }} />
            <div className="w-1 h-1 bg-red-500 rounded-full" />
            
            {Date.now() - state.lastHitTime < 100 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-red-500 rotate-45 scale-150 opacity-100" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      <div className="flex justify-between items-end">
        <div className="space-y-4">
          <div className="bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-xl flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Heart className="w-6 h-6 text-red-500 fill-red-500" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Health</div>
                <div className="text-2xl font-black text-white">{state.health} / {state.maxHealth}</div>
              </div>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Shield className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Medikits</div>
                <div className="text-2xl font-black text-white">{state.medikits}</div>
              </div>
            </div>
          </div>

          {/* Crouch indicator */}
          {state.isCrouching && (
            <div className="bg-green-500/20 backdrop-blur-md border border-green-500/30 px-3 py-1 rounded-lg">
              <span className="text-green-400 text-[10px] font-black uppercase tracking-widest">Crouched — Stealth Active</span>
            </div>
          )}

          {otherWeapons.length > 0 && (
            <div className="bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-xl space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Holstered</div>
              <div className="flex flex-col gap-1">
                {otherWeapons.map((w, i) => (
                  <div key={`holstered-${w.type}-${i}`} className="flex items-center gap-2 text-white/60 text-xs font-bold uppercase">
                    <div className="w-1 h-1 bg-white/40 rounded-full" />
                    {w.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {currentWeapon && (
          <div className="bg-black/60 backdrop-blur-md border border-white/10 p-6 rounded-xl flex items-center gap-8">
            <div className="text-right">
              {state.isReloading ? (
                <div className="text-2xl font-black text-red-500 animate-pulse uppercase italic tracking-tighter">Reloading...</div>
              ) : (
                <>
                  <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{currentWeapon.name}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-black text-white">{currentWeapon.type === WeaponType.KNIFE ? '∞' : currentWeapon.ammo}</span>
                    {currentWeapon.type !== WeaponType.KNIFE && <span className="text-xl font-bold text-white/40">/ {currentWeapon.reserve}</span>}
                  </div>
                </>
              )}
            </div>
            <div className="w-24 h-12 bg-white/5 rounded-lg flex items-center justify-center">
               <Crosshair className="w-8 h-8 text-white/20" />
            </div>
          </div>
        )}
      </div>

      {/* FPS Counter — top right, F3 to toggle */}
      {showFps && (
        <div className="fixed top-4 right-4 bg-black/70 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-lg z-[999]">
          <FpsCounter quality={state.settings.quality} />
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Custom comparison to reduce re-renders.
  // HUD only needs to update when visible stats change.
  const currentWeaponIdx = next.state.currentWeaponIndex;
  const prevWeaponIdx = prev.state.currentWeaponIndex;

  return prev.state.health === next.state.health &&
         prev.state.medikits === next.state.medikits &&
         Math.abs(prev.state.stealthLevel - next.state.stealthLevel) < 0.01 &&
         prev.state.enemiesKilled === next.state.enemiesKilled &&
         prev.state.totalEnemiesInLevel === next.state.totalEnemiesInLevel &&
         currentWeaponIdx === prevWeaponIdx &&
         prev.state.weapons[prevWeaponIdx]?.ammo === next.state.weapons[currentWeaponIdx]?.ammo &&
         prev.state.weapons[prevWeaponIdx]?.reserve === next.state.weapons[currentWeaponIdx]?.reserve &&
         prev.nearPickup === next.nearPickup &&
         prev.state.isCrouching === next.state.isCrouching &&
         prev.state.isRunning === next.state.isRunning &&
         prev.state.isReloading === next.state.isReloading &&
         prev.state.isPaused === next.state.isPaused &&
         prev.state.damageDirectionTime === next.state.damageDirectionTime &&
         prev.state.killFeedTime === next.state.killFeedTime &&
         prev.state.lastHitTime === next.state.lastHitTime &&
         prev.state.screenShake === next.state.screenShake &&
         prev.showFpsOverride === next.showFpsOverride;
});

export default HUD;
