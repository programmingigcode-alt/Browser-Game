export enum WeaponType {
  PISTOL = 'PISTOL',
  SHOTGUN = 'SHOTGUN',
  RIFLE = 'RIFLE',
  ASSAULT_RIFLE = 'ASSAULT_RIFLE',
  REVOLVER = 'REVOLVER',
  KNIFE = 'KNIFE',
}

export enum AttachmentType {
  SCOPE = 'SCOPE',
  SILENCER = 'SILENCER',
  EXTENDED_MAG = 'EXTENDED_MAG',
  RECOIL_CONTROLLER = 'RECOIL_CONTROLLER'
}

export interface Weapon {
  type: WeaponType;
  name: string;
  damage: number;
  range: number;
  ammo: number;
  maxAmmo: number;
  reserve: number;
  fireRate: number;
  reloadTime: number;
  description: string;
  attachments: AttachmentType[];
}

export enum Difficulty {
  STANDARD = 'STANDARD',
  HARDCORE = 'HARDCORE'
}

export interface Keybinds {
  moveForward: string;
  moveBackward: string;
  moveLeft: string;
  moveRight: string;
  sprint: string;
  crouch: string;
  reload: string;
  medikit: string;
  weapon1: string;
  weapon2: string;
  weapon3: string;
  inventory: string;
  pause: string;
  shoot: string;
  aim: string;
  interact: string;
}

export interface Settings {
  masterVolume: number;      // 0-100
  musicVolume: number;       // 0-100
  sfxVolume: number;         // 0-100
  footstepVolume: number;    // 0-100
  mouseSensitivity: number;  // 0.1-3.0
  quality: 'Low' | 'Medium' | 'High' | 'Ultra';
  textureQuality: 'Low' | 'Medium' | 'High' | 'Ultra';
  shadows: boolean;
  postProcessing: boolean;
  renderScale: number;       // 0.5-2.0 (multiplied on top of DPR)
  showFps: boolean;
  fov: number;               // 60-110
  keybinds: Keybinds;
  particleDensity: number;   // 0-100
}

export interface GameState {
  health: number;
  maxHealth: number;
  medikits: number;
  currentWeaponIndex: number;
  weapons: Weapon[];
  availableAttachments: AttachmentType[];
  currentAct: number;
  currentChapter: number;
  isPaused: boolean;
  isGameOver: boolean;
  enemiesKilled: number;
  totalEnemiesInLevel: number;
  gameStarted: boolean;
  showPrologue: boolean;
  showStory: boolean;
  isAiming: boolean;
  isReloading: boolean;
  isHealing: boolean;
  lastHitTime: number;
  isLocked: boolean;
  isInventoryOpen: boolean;
  isCrouching: boolean;
  isInteracting: boolean;
  difficulty: Difficulty;
  isTestRun: boolean;
  showLoadGame: boolean;
  showWeaponStats: boolean;
  showSettings: boolean;
  showZoneCompletionPrompt: boolean;
  isZoneCompleted: boolean;
  settings: Settings;
  // --- New gameplay fields ---
  stealthLevel: number;        // 0 = invisible, 1 = fully visible
  isRunning: boolean;          // true when sprinting
  damageDirection: number;     // angle in radians of last incoming damage (0 = front)
  damageDirectionTime: number; // timestamp of last damage direction event
  screenShake: number;         // intensity of current screen shake (0 = none)
  killStreak: number;          // consecutive kills within time window
  lastKillTime: number;        // timestamp of last kill for streak tracking
  killFeedMessage: string;     // current kill feed text to display
  killFeedTime: number;        // timestamp of kill feed message
}

export interface ChapterData {
  id: number;
  title: string;
  act: number;
  content: string;
  enemyCount: number;
  location: string;
  unlocks?: WeaponType;
  medikitCount: number;
  isBoss?: boolean;
  bossName?: string;
  bossHP?: number;
  bossPhases?: number;
  isMinisBoss?: boolean;
  miniBossName?: string;
  miniBossHP?: number;
  /** For 0-enemy chapters: position [x,z] the player must reach to complete the zone */
  objectivePosition?: [number, number];
  /** Label shown on HUD for the objective */
  objectiveLabel?: string;
}
