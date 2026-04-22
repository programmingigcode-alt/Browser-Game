import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { GameState, Difficulty } from '@/types';

// Inline utility — avoids @/lib/utils resolution during IDE cold-start
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

// ─── Reusable slider row ─────────────────────────────────────────────
const SliderRow = ({
  label, value, min, max, step = 1, unit = '', format,
  onChange,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; unit?: string; format?: (v: number) => string;
  onChange: (v: number) => void;
}) => (
  <div className="flex justify-between items-center gap-4">
    <span className="text-white/70 text-[11px] uppercase tracking-widest font-bold min-w-[140px]">{label}</span>
    <div className="flex items-center gap-3 flex-1">
      <input
        type="range" min={min} max={max} step={step} value={value}
        className="flex-1 accent-red-500 cursor-pointer"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="text-white font-black text-xs w-12 text-right tabular-nums">
        {format ? format(value) : `${value}${unit}`}
      </span>
    </div>
  </div>
);

// ─── Toggle row ──────────────────────────────────────────────────────
const ToggleRow = ({
  label, value, onChange, description,
}: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) => (
  <div className="flex justify-between items-center gap-4">
    <div>
      <div className="text-white/70 text-[11px] uppercase tracking-widest font-bold">{label}</div>
      {description && <div className="text-white/30 text-[9px] mt-0.5">{description}</div>}
    </div>
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0',
        value ? 'bg-red-500' : 'bg-white/20'
      )}
    >
      <span className={cn(
        'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
        value ? 'translate-x-7' : 'translate-x-1'
      )} />
    </button>
  </div>
);

// ─── Select row ──────────────────────────────────────────────────────
const SelectRow = ({
  label, value, options, onChange,
}: {
  label: string; value: string; options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) => (
  <div className="flex justify-between items-center gap-4">
    <span className="text-white/70 text-[11px] uppercase tracking-widest font-bold min-w-[140px]">{label}</span>
    <div className="flex gap-1">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'px-3 py-1 text-[10px] font-black uppercase tracking-widest border transition-all',
            value === o.v
              ? 'bg-red-500 border-red-500 text-white'
              : 'border-white/20 text-white/40 hover:text-white hover:border-white/60'
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  </div>
);

const TABS = ['audio', 'graphics', 'gameplay', 'controls'] as const;
type Tab = typeof TABS[number];

const SettingsMenu = ({ state, dispatch, onBack }: {
  state: GameState;
  dispatch: React.Dispatch<React.SetStateAction<GameState>>;
  onBack: () => void;
}) => {
  const [tab, setTab] = useState<Tab>('audio');
  const [rebindingKey, setRebindingKey] = useState<string | null>(null);

  const set = (patch: Partial<GameState['settings']>) =>
    dispatch(prev => ({ ...prev, settings: { ...prev.settings, ...patch } }));

  // Keybinding capture
  useEffect(() => {
    if (!rebindingKey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      set({ keybinds: { ...state.settings.keybinds, [rebindingKey]: e.code } });
      setRebindingKey(null);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      set({ keybinds: { ...state.settings.keybinds, [rebindingKey]: `Mouse${e.button}` } });
      setRebindingKey(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouse);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onMouse); };
  }, [rebindingKey, state.settings.keybinds]);

  const formatKey = (k: string) =>
    k.replace('Key', '').replace('Digit', '')
      .replace('Mouse0', 'LMB').replace('Mouse1', 'MMB').replace('Mouse2', 'RMB')
      .replace('ShiftLeft', 'L.Shift').replace('ControlLeft', 'L.Ctrl').replace('AltLeft', 'L.Alt')
      .replace('ShiftRight', 'R.Shift').replace('Escape', 'ESC').replace('Space', 'SPACE');

  const KEYBIND_LABELS: Record<string, string> = {
    moveForward: 'Move Forward', moveBackward: 'Move Backward',
    moveLeft: 'Move Left', moveRight: 'Move Right',
    sprint: 'Sprint', crouch: 'Crouch',
    reload: 'Reload', medikit: 'Use Medikit',
    weapon1: 'Weapon Slot 1', weapon2: 'Weapon Slot 2', weapon3: 'Weapon Slot 3',
    inventory: 'Inventory', pause: 'Pause',
    shoot: 'Fire', aim: 'Aim', interact: 'Interact',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="relative z-10 w-full max-w-2xl bg-black/90 backdrop-blur-xl p-10 border border-white/10 rounded-xl"
      style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4 flex-shrink-0">
        <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter">Settings</h2>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all',
                tab === t ? 'bg-red-500 text-white' : 'text-white/40 hover:text-white hover:bg-white/10'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">

        {/* ── AUDIO ─────────────────────────────────────── */}
        {tab === 'audio' && (
          <div className="space-y-5">
            <div className="text-red-500 text-[10px] font-black uppercase tracking-widest">Volume</div>
            <SliderRow label="Master Volume" value={state.settings.masterVolume} min={0} max={100}
              unit="%" onChange={v => set({ masterVolume: v })} />
            <SliderRow label="Music Volume" value={state.settings.musicVolume} min={0} max={100}
              unit="%" onChange={v => set({ musicVolume: v })} />
            <SliderRow label="SFX Volume" value={state.settings.sfxVolume} min={0} max={100}
              unit="%" onChange={v => set({ sfxVolume: v })} />
            <SliderRow label="Footstep Volume" value={state.settings.footstepVolume} min={0} max={100}
              unit="%" onChange={v => set({ footstepVolume: v })}
            />
            <div className="border-t border-white/10 pt-4 text-white/30 text-[9px] uppercase tracking-widest space-y-1">
              <p>• Music volume controls <span className="text-white/50">PrimalFracture.wav</span> — the game's main theme, looped</p>
              <p>• SFX controls gunfire, impacts, pickups</p>
              <p>• Footstep volume controls movement audio from player and enemies</p>
            </div>
          </div>
        )}

        {/* ── GRAPHICS ──────────────────────────────────── */}
        {tab === 'graphics' && (
          <div className="space-y-5">
            <div className="text-red-500 text-[10px] font-black uppercase tracking-widest">Presets</div>
            <SelectRow label="Quality Preset" value={state.settings.quality}
              options={[{ v: 'Low', l: 'Low' }, { v: 'Medium', l: 'Med' }, { v: 'High', l: 'High' }, { v: 'Ultra', l: 'Ultra' }]}
              onChange={v => {
                const q = v as GameState['settings']['quality'];
                set({
                  quality: q, textureQuality: q,
                  shadows: q !== 'Low',
                  postProcessing: q !== 'Low',
                  renderScale: q === 'Low' ? 0.6 : q === 'Medium' ? 0.85 : 1.0,
                  particleDensity: q === 'Low' ? 30 : 50,
                });
              }}
            />
            <SelectRow label="Texture Quality" value={state.settings.textureQuality}
              options={[{ v: 'Low', l: 'Low' }, { v: 'Medium', l: 'Med' }, { v: 'High', l: 'High' }, { v: 'Ultra', l: 'Ultra' }]}
              onChange={v => set({ textureQuality: v as any })}
            />

            <div className="border-t border-white/10 pt-4 text-red-500 text-[10px] font-black uppercase tracking-widest">
              Render
            </div>
            <SliderRow
              label="Render Scale" value={Math.round(state.settings.renderScale * 100)} min={40} max={150}
              format={v => `${v}%`}
              onChange={v => set({ renderScale: v / 100 })}
            />
            <SliderRow
              label="Field of View" value={state.settings.fov} min={60} max={110} unit="°"
              onChange={v => set({ fov: v })}
            />
            <SliderRow
              label="Particle Density" value={state.settings.particleDensity} min={0} max={100}
              unit="%" onChange={v => set({ particleDensity: v })}
            />

            <div className="border-t border-white/10 pt-4 text-red-500 text-[10px] font-black uppercase tracking-widest">
              Features
            </div>
            <ToggleRow label="Shadows" value={state.settings.shadows} onChange={v => set({ shadows: v })}
              description="Disable for significant performance boost on integrated graphics" />
            <ToggleRow label="Post-Processing" value={state.settings.postProcessing}
              onChange={v => set({ postProcessing: v })}
              description="Bloom, FXAA, vignette, depth of field. Disable on iGPU." />
            <ToggleRow label="Show FPS Counter" value={state.settings.showFps}
              onChange={v => set({ showFps: v })}
              description="Also toggleable with F3 key in-game" />

            <div className="border-t border-white/10 pt-3 text-white/20 text-[9px] space-y-1">
              <p>🟢 RTX 3050: Recommended High, Render Scale 100%</p>
              <p>🟡 Intel UHD 630: Recommended Low, Render Scale 60%, no Shadows/Post-Processing</p>
            </div>
          </div>
        )}

        {/* ── GAMEPLAY ──────────────────────────────────── */}
        {tab === 'gameplay' && (
          <div className="space-y-5">
            <div className="text-red-500 text-[10px] font-black uppercase tracking-widest">Difficulty</div>
            <div className="flex gap-3">
              {[Difficulty.STANDARD, Difficulty.HARDCORE].map(d => (
                <button key={d}
                  onClick={() => dispatch(prev => ({ ...prev, difficulty: d }))}
                  className={cn(
                    'flex-1 py-3 border text-[10px] font-black uppercase tracking-widest transition-all rounded',
                    state.difficulty === d
                      ? 'bg-red-500 border-red-500 text-white'
                      : 'border-white/20 text-white/40 hover:border-white/60 hover:text-white'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="text-white/30 text-[9px] leading-relaxed">
              {state.difficulty === Difficulty.STANDARD
                ? 'Standard tactical parameters. Enemy count matches campaign intelligence reports.'
                : 'Hardcore: 3–5 additional hostiles per zone. Enemies have improved accuracy and reaction time.'}
            </p>

            <div className="border-t border-white/10 pt-4 text-red-500 text-[10px] font-black uppercase tracking-widest">Input</div>
            <SliderRow
              label="Mouse Sensitivity" value={Math.round(state.settings.mouseSensitivity * 100)} min={10} max={300}
              format={v => `${(v / 100).toFixed(1)}×`}
              onChange={v => set({ mouseSensitivity: v / 100 })}
            />
          </div>
        )}

        {/* ── CONTROLS ──────────────────────────────────── */}
        {tab === 'controls' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-red-500 text-[10px] font-black uppercase tracking-widest">Key Bindings</div>
              {rebindingKey
                ? <span className="text-[9px] text-red-400 animate-pulse font-black uppercase tracking-widest">Press any key or mouse button...</span>
                : <span className="text-[9px] text-white/30 uppercase tracking-widest">Click a binding to remap</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[10px]">
              {Object.entries(state.settings.keybinds).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => setRebindingKey(rebindingKey === key ? null : key)}
                  className={cn(
                    'flex justify-between items-center py-1.5 px-2 rounded border-b border-white/5 hover:bg-white/5 transition-colors',
                    rebindingKey === key && 'bg-red-500/20 border-red-500/40'
                  )}
                >
                  <span className="text-white/50">{KEYBIND_LABELS[key] || key}</span>
                  <span className={cn('font-black', rebindingKey === key ? 'text-red-400' : 'text-white')}>
                    {rebindingKey === key ? '???' : formatKey(value)}
                  </span>
                </button>
              ))}
            </div>
            <div className="border-t border-white/10 pt-2">
              <button
                onClick={() => set({
                  keybinds: {
                    moveForward: 'KeyW', moveBackward: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
                    sprint: 'ShiftLeft', crouch: 'KeyC', reload: 'KeyR', medikit: 'KeyQ',
                    weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3',
                    inventory: 'Tab', pause: 'Escape', shoot: 'Mouse0', aim: 'Mouse2', interact: 'KeyE',
                  }
                })}
                className="text-[9px] text-white/30 hover:text-red-400 font-black uppercase tracking-widest transition-colors"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 mt-6 pt-4 border-t border-white/10">
        <button
          onClick={onBack}
          className="px-8 py-3 bg-white text-black font-black uppercase tracking-widest rounded-sm hover:bg-red-500 hover:text-white transition-colors text-sm"
        >
          Back
        </button>
      </div>
    </motion.div>
  );
};

export default SettingsMenu;
