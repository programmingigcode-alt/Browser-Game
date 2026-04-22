import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Sky, Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

// ─── Procedural Noise ───────────────────────────────────────────────
// Fast pseudo-random hash for noise
const hash = (x: number, z: number) => {
  let n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

// Smooth interpolation
const smoothstep = (t: number) => t * t * (3 - 2 * t);

// Value noise with smooth interpolation
const valueNoise = (x: number, z: number) => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = smoothstep(fx);
  const sz = smoothstep(fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
};

// Fractal Brownian Motion — layered noise for natural terrain
const fbm = (x: number, z: number, octaves: number, lacunarity: number, gain: number) => {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
};

// ─── Terrain Height Cache ───────────────────────────────────────────
// Cache last few lookups to avoid redundant FBM noise calculations
// Especially useful when multiple systems (AI, particles, player) query same area
const HEIGHT_CACHE_SIZE = 16;
const heightCache: { [key: string]: { x: number, z: number, h: number, t: string }[] } = {};

// ─── Terrain Height Function — used by all systems ──────────────────
// quality parameter: pass 'Low' to use fewer octaves on iGPU
export const getTerrainHeight = (x: number, z: number, terrainType: string, lowQ = false): number => {
  // Simple spatial hashing for cache
  const gridX = Math.round(x * 10) / 10;
  const gridZ = Math.round(z * 10) / 10;

  if (!heightCache[terrainType]) heightCache[terrainType] = [];
  const cache = heightCache[terrainType];
  const cached = cache.find(c => c.x === gridX && c.z === gridZ);
  if (cached) return cached.h;

  const oct = (high: number) => lowQ ? Math.min(2, Math.ceil(high / 2)) : high;
  let height = 0;

  switch (terrainType) {
    case 'jungle': {
      const base = fbm(x * 0.008, z * 0.008, oct(6), 2.2, 0.48) * 18;
      if (lowQ) { height = base; break; }
      const ridge = Math.max(0, fbm(x * 0.004 + 50, z * 0.004 + 50, 4, 2.0, 0.5) - 0.55) * 40;
      height = base + ridge;
      break;
    }
    case 'shore': {
      const dune = fbm(x * 0.012, z * 0.012, oct(4), 2.0, 0.45) * 5;
      const slope = Math.max(0, -z * 0.01);
      height = Math.max(-0.5, dune - slope);
      break;
    }
    case 'volcanic': {
      const raw = fbm(x * 0.006, z * 0.006, oct(5), 2.5, 0.55) * 30;
      if (lowQ) { height = raw; break; }
      const sharp = Math.pow(Math.abs(fbm(x * 0.015, z * 0.015, 3, 2.0, 0.6) - 0.5) * 2, 1.5) * 15;
      height = raw + sharp;
      break;
    }
    case 'prison':
      height = fbm(x * 0.02, z * 0.02, 2, 2.0, 0.4) * 1.5;
      break;
    case 'port':
      // Flat dockyard — very slight undulation, mostly concrete/asphalt
      height = fbm(x * 0.025, z * 0.025, 2, 2.0, 0.35) * 0.8;
      break;
    case 'base':
      // Military camp — slightly more undulation than port, packed dirt
      height = fbm(x * 0.015, z * 0.015, 3, 2.0, 0.42) * 2.0;
      break;
    case 'ruins': {
      height = fbm(x * 0.01, z * 0.01, oct(4), 2.0, 0.5) * 6;
      break;
    }
    default:
      height = fbm(x * 0.008, z * 0.008, oct(5), 2.2, 0.48) * 12;
      break;
  }

  cache.push({ x: gridX, z: gridZ, h: height, t: terrainType });
  if (cache.length > HEIGHT_CACHE_SIZE) cache.shift();
  return height;
};

// Legacy noise for water-area check
export const simplexNoise = (x: number, z: number) => {
  return (fbm(x * 0.008, z * 0.008, 3, 2.0, 0.5) - 0.5) * 20;
};

export const isWaterArea = (x: number, z: number, terrainType: string) => {
  if (terrainType === 'prison' || terrainType === 'port' || terrainType === 'base') return false;
  if (terrainType === 'shore') return getTerrainHeight(x, z, terrainType) < -0.3;
  return getTerrainHeight(x, z, terrainType) < -2;
};

export const getTerrainType = (loc: string) => {
  const l = loc.toLowerCase();
  if (l.includes('prison')) return 'prison';
  if (l.includes('ruins') || l.includes('village')) return 'ruins';
  // Port: dockyard and streets (the port-side urban area)
  if (l.includes('dockyard') || l.includes('streets')) return 'port';
  // Base: military camps, facilities, HQs, offices, medical
  if (l.includes('base') || l.includes('camp') || l.includes('outpost') || l.includes('facility') || l.includes('office') || l.includes('headquarters') || l.includes('medical')) return 'base';
  if (l.includes('volcanic') || l.includes('lava') || l.includes('volcano') || l.includes('tunnel') || l.includes('detonation') || l.includes('processing')) return 'volcanic';
  if (l.includes('shore')) return 'shore';
  return 'jungle';
};

// ─── Biome Color Palette ────────────────────────────────────────────
const BIOME_COLORS: Record<string, { low: THREE.Color; mid: THREE.Color; high: THREE.Color; rock: THREE.Color; water: THREE.Color }> = {
  jungle: {
    low: new THREE.Color('#1a4a1a'),   // dark jungle floor
    mid: new THREE.Color('#2d6a2d'),   // lush green
    high: new THREE.Color('#8b7355'),  // exposed earth on ridges
    rock: new THREE.Color('#555544'),  // mossy rock
    water: new THREE.Color('#1a5566'), // murky river
  },
  shore: {
    low: new THREE.Color('#c2b280'),   // pale sand
    mid: new THREE.Color('#a0926a'),   // wet sand
    high: new THREE.Color('#6b8a3d'),  // dune grass
    rock: new THREE.Color('#888877'),  // beach rock
    water: new THREE.Color('#1a7799'), // clear tropical
  },
  volcanic: {
    low: new THREE.Color('#1a0808'),   // black basalt
    mid: new THREE.Color('#2a1515'),   // dark red rock
    high: new THREE.Color('#3a2222'),  // oxidized
    rock: new THREE.Color('#111111'),  // obsidian
    water: new THREE.Color('#cc3300'), // lava glow
  },
  prison: {
    low: new THREE.Color('#3a3a3a'),   // concrete
    mid: new THREE.Color('#444444'),   // concrete
    high: new THREE.Color('#555555'),  // concrete
    rock: new THREE.Color('#333333'),  // dark concrete
    water: new THREE.Color('#224466'), // puddle
  },
  port: {
    low: new THREE.Color('#2e2e2e'),   // wet concrete
    mid: new THREE.Color('#3a3a3a'),   // dockyard floor
    high: new THREE.Color('#4a4a4a'),  // worn asphalt
    rock: new THREE.Color('#333333'),
    water: new THREE.Color('#1a5577'), // harbor water
  },
  base: {
    low: new THREE.Color('#4a3a28'),   // packed dirt
    mid: new THREE.Color('#5a4a35'),   // sandy ground
    high: new THREE.Color('#6a5a42'),  // dry earth
    rock: new THREE.Color('#3a3028'),
    water: new THREE.Color('#336644'),
  },
  ruins: {
    low: new THREE.Color('#3a4a2a'),   // muddy grass
    mid: new THREE.Color('#4a5a3a'),   // green-brown
    high: new THREE.Color('#6a5a4a'),  // rubble
    rock: new THREE.Color('#555544'),
    water: new THREE.Color('#336644'),
  },
};

// ─── Terrain Mesh ──────────────────────────────────────────────────
function Terrain({ terrainType, quality }: { terrainType: string; quality: string }) {
  const isLowQ = quality === 'Low';
  // iGPU: 48×48 = 2304 tris (vs 80×80=6400). High: 192. Ultra: 256.
  const resolution = isLowQ ? 48 : quality === 'Medium' ? 96 : quality === 'High' ? 168 : 240;
  const terrainSize = 600;

  const { geometry, waterGeometry } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(terrainSize, terrainSize, resolution, resolution);
    const verts = geo.attributes.position.array as Float32Array;
    const colors = new Float32Array(verts.length);
    const palette = BIOME_COLORS[terrainType] || BIOME_COLORS.jungle;
    const tempColor = new THREE.Color();

    // Compute normals buffer for slope calculation
    const normals: THREE.Vector3[] = [];

    // First pass: set heights (use low-octave fast path on iGPU)
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i];
      const worldZ = -verts[i + 1];
      verts[i + 2] = getTerrainHeight(x, worldZ, terrainType, isLowQ);
    }

    geo.computeVertexNormals();
    const normalArr = geo.attributes.normal.array as Float32Array;

    // Second pass: compute vertex colors based on height + slope
    for (let i = 0; i < verts.length; i += 3) {
      const h = verts[i + 2];
      const nx = normalArr[i];
      const ny = normalArr[i + 1];
      const nz = normalArr[i + 2];
      // Slope: 1 = flat, 0 = vertical cliff
      const slope = nz; // since plane is XY before rotation, Z-normal = "up"

      // Height-based color blend
      const maxH = terrainType === 'volcanic' ? 30 : terrainType === 'jungle' ? 18 : 8;
      const normalizedH = Math.max(0, Math.min(1, h / maxH));

      if (normalizedH < 0.3) {
        tempColor.copy(palette.low).lerp(palette.mid, normalizedH / 0.3);
      } else if (normalizedH < 0.7) {
        tempColor.copy(palette.mid).lerp(palette.high, (normalizedH - 0.3) / 0.4);
      } else {
        tempColor.copy(palette.high);
      }

      // Steep slopes get rock color
      if (slope < 0.7) {
        const rockBlend = 1 - (slope - 0.4) / 0.3;
        tempColor.lerp(palette.rock, Math.max(0, Math.min(1, rockBlend)));
      }

      // Water areas get water color
      if (h < -0.3 && terrainType !== 'prison' && terrainType !== 'port' && terrainType !== 'base') {
        tempColor.copy(palette.water);
      }

      // Subtle variation via noise to break up uniformity
      const variation = (hash(verts[i] * 0.1, -verts[i + 1] * 0.1) - 0.5) * 0.05;
      tempColor.r = Math.max(0, Math.min(1, tempColor.r + variation));
      tempColor.g = Math.max(0, Math.min(1, tempColor.g + variation));
      tempColor.b = Math.max(0, Math.min(1, tempColor.b + variation));

      colors[i] = tempColor.r;
      colors[i + 1] = tempColor.g;
      colors[i + 2] = tempColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals(); // recompute after height changes

    // Water plane geometry (simple flat plane at y=0)
    const waterGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, 1, 1);

    return { geometry: geo, waterGeometry: waterGeo };
  }, [terrainType, resolution, terrainSize]);

  const showWater = terrainType !== 'prison' && terrainType !== 'base';

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        geometry={geometry}
      >
        <meshStandardMaterial vertexColors roughness={0.85} metalness={0.05} />
      </mesh>
      {showWater && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, terrainType === 'port' ? -0.2 : -0.5, 0]}
          geometry={waterGeometry}
        >
          <meshStandardMaterial
            color={BIOME_COLORS[terrainType]?.water || '#1a5566'}
            transparent
            opacity={terrainType === 'volcanic' ? 0.9 : terrainType === 'port' ? 0.7 : 0.6}
            roughness={terrainType === 'volcanic' ? 0.3 : 0.1}
            metalness={terrainType === 'volcanic' ? 0.2 : 0.3}
          />
        </mesh>
      )}
    </>
  );
}

// ─── Structures ─────────────────────────────────────────────────────
function PrisonStructure({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[4, 1, 4]} />
        <meshStandardMaterial color="#555" />
      </mesh>
      <mesh position={[0, 2, -2]} castShadow>
        <boxGeometry args={[4, 3, 0.2]} />
        <meshStandardMaterial color="#444" />
      </mesh>
      <mesh position={[-2, 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[4, 3, 0.2]} />
        <meshStandardMaterial color="#444" />
      </mesh>
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} position={[-1.8 + i * 0.5, 2, 1.9]}>
          <cylinderGeometry args={[0.05, 0.05, 3]} />
          <meshStandardMaterial color="#222" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 3.5, 0]}>
        <boxGeometry args={[4.2, 0.2, 4.2]} />
        <meshStandardMaterial color="#333" />
      </mesh>
    </group>
  );
}

// ─── PORT STRUCTURES ─────────────────────────────────────────────────
// Shipping Container — large metal box with corrugation detail
function ShippingContainer({ position, rotation = 0, color = '#8b4513' }: { position: [number, number, number]; rotation?: number; color?: string }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Main body */}
      <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 2.8, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.4} />
      </mesh>
      {/* Corrugation ridges */}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={`corr-${i}`} position={[1.26, 1.4, -2.5 + i * 0.55]} castShadow>
          <boxGeometry args={[0.04, 2.6, 0.15]} />
          <meshStandardMaterial color={color} roughness={0.8} metalness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={`corrl-${i}`} position={[-1.26, 1.4, -2.5 + i * 0.55]} castShadow>
          <boxGeometry args={[0.04, 2.6, 0.15]} />
          <meshStandardMaterial color={color} roughness={0.8} metalness={0.5} />
        </mesh>
      ))}
      {/* Door bars */}
      <mesh position={[0, 1.4, 3.01]}>
        <boxGeometry args={[0.1, 2.5, 0.05]} />
        <meshStandardMaterial color="#333" metalness={0.6} />
      </mesh>
      {/* Corner posts */}
      {[[-1.2, -2.95], [-1.2, 2.95], [1.2, -2.95], [1.2, 2.95]].map(([x, z], i) => (
        <mesh key={`post-${i}`} position={[x, 1.4, z]} castShadow>
          <boxGeometry args={[0.15, 2.8, 0.15]} />
          <meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

// Dock Crane — tall gantry crane
function DockCrane({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Left support leg */}
      <mesh position={[-4, 8, 0]} castShadow>
        <boxGeometry args={[0.6, 16, 0.6]} />
        <meshStandardMaterial color="#cc6600" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Right support leg */}
      <mesh position={[4, 8, 0]} castShadow>
        <boxGeometry args={[0.6, 16, 0.6]} />
        <meshStandardMaterial color="#cc6600" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Cross beam */}
      <mesh position={[0, 16, 0]} castShadow>
        <boxGeometry args={[9, 0.8, 1.2]} />
        <meshStandardMaterial color="#cc6600" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Boom arm extending out */}
      <mesh position={[6, 16.5, 0]} castShadow>
        <boxGeometry args={[12, 0.5, 0.8]} />
        <meshStandardMaterial color="#cc6600" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Operator cabin */}
      <mesh position={[0, 15, 0]} castShadow>
        <boxGeometry args={[2, 2.5, 2]} />
        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Cabin window */}
      <mesh position={[0, 15.3, 1.01]}>
        <boxGeometry args={[1.4, 1, 0.05]} />
        <meshStandardMaterial color="#88bbdd" transparent opacity={0.5} />
      </mesh>
      {/* Cable */}
      <mesh position={[8, 10, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 12, 4]} />
        <meshStandardMaterial color="#555" metalness={0.8} />
      </mesh>
      {/* Hook */}
      <mesh position={[8, 4, 0]}>
        <torusGeometry args={[0.3, 0.08, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#444" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Rail tracks on ground */}
      {[-4.3, 4.3].map((x, i) => (
        <mesh key={`rail-${i}`} position={[x, 0.05, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.2, 0.1, 30]} />
          <meshStandardMaterial color="#555" metalness={0.6} />
        </mesh>
      ))}
      {/* Warning stripes */}
      <mesh position={[-4, 0.5, 0]}>
        <boxGeometry args={[0.62, 1, 0.62]} />
        <meshStandardMaterial color="#ffcc00" roughness={0.5} />
      </mesh>
      <mesh position={[4, 0.5, 0]}>
        <boxGeometry args={[0.62, 1, 0.62]} />
        <meshStandardMaterial color="#ffcc00" roughness={0.5} />
      </mesh>
    </group>
  );
}

// Dock Ship — large cargo vessel moored at dock
function DockedShip({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Hull */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[6, 3, 18]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.8} metalness={0.3} />
      </mesh>
      {/* Hull bottom taper */}
      <mesh position={[0, -1, 0]} castShadow>
        <boxGeometry args={[4.5, 1, 16]} />
        <meshStandardMaterial color="#4a1515" roughness={0.9} />
      </mesh>
      {/* Waterline stripe */}
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[6.05, 0.3, 18.05]} />
        <meshStandardMaterial color="#cc3333" roughness={0.7} />
      </mesh>
      {/* Deck */}
      <mesh position={[0, 2.05, 0]} receiveShadow>
        <boxGeometry args={[5.5, 0.1, 17]} />
        <meshStandardMaterial color="#5a5a5a" roughness={0.9} />
      </mesh>
      {/* Bridge/superstructure */}
      <mesh position={[0, 4.5, -5]} castShadow>
        <boxGeometry args={[4, 5, 4]} />
        <meshStandardMaterial color="#ddd" roughness={0.5} />
      </mesh>
      {/* Bridge windows */}
      <mesh position={[0, 5.5, -2.99]}>
        <boxGeometry args={[3.2, 1.5, 0.05]} />
        <meshStandardMaterial color="#88bbdd" transparent opacity={0.5} />
      </mesh>
      {/* Funnel/smokestack */}
      <mesh position={[0, 8, -6]} castShadow>
        <cylinderGeometry args={[0.6, 0.8, 3, 8]} />
        <meshStandardMaterial color="#cc6600" roughness={0.6} />
      </mesh>
      <mesh position={[0, 9.6, -6]}>
        <cylinderGeometry args={[0.7, 0.6, 0.3, 8]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* Cargo hatches */}
      {[0, 4, 8].map((z, i) => (
        <mesh key={`hatch-${i}`} position={[0, 2.15, -2 + z]} receiveShadow>
          <boxGeometry args={[3.5, 0.15, 2.5]} />
          <meshStandardMaterial color="#4a6a4a" roughness={0.7} />
        </mesh>
      ))}
      {/* Deck cranes (small) */}
      {[-2, 6].map((z, i) => (
        <group key={`dcrane-${i}`} position={[2, 2.1, z]}>
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.1, 3, 6]} />
            <meshStandardMaterial color="#cc6600" />
          </mesh>
          <mesh position={[0.8, 3, 0]} rotation={[0, 0, Math.PI / 6]} castShadow>
            <boxGeometry args={[0.08, 2, 0.08]} />
            <meshStandardMaterial color="#cc6600" />
          </mesh>
        </group>
      ))}
      {/* Mooring bollards */}
      {[-8, 8].map((z, i) => (
        <mesh key={`bollard-${i}`} position={[3.5, 2.2, z]}>
          <cylinderGeometry args={[0.08, 0.12, 0.3, 8]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

// Yacht — smaller vessel
function Yacht({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Hull */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[2.5, 1.2, 8]} />
        <meshStandardMaterial color="#eee" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Bow taper */}
      <mesh position={[0, 0.2, 4.5]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[1.25, 2.5, 4]} />
        <meshStandardMaterial color="#eee" roughness={0.3} />
      </mesh>
      {/* Deck */}
      <mesh position={[0, 0.85, 0]} receiveShadow>
        <boxGeometry args={[2.2, 0.05, 7.5]} />
        <meshStandardMaterial color="#8b6914" roughness={0.9} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.5, -1]} castShadow>
        <boxGeometry args={[1.8, 1.2, 3]} />
        <meshStandardMaterial color="#f5f5f5" roughness={0.4} />
      </mesh>
      {/* Windshield */}
      <mesh position={[0, 1.8, 0.51]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[1.5, 0.8, 0.03]} />
        <meshStandardMaterial color="#88ccff" transparent opacity={0.4} />
      </mesh>
      {/* Flybridge */}
      <mesh position={[0, 2.2, -1]}>
        <boxGeometry args={[2, 0.08, 3.2]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      {/* Railing */}
      {[-1, 0, 1, 2, 3].map((z, i) => (
        <React.Fragment key={`yr-${i}`}>
          <mesh position={[1.15, 1.2, -1 + z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 4]} />
            <meshStandardMaterial color="#bbb" metalness={0.6} />
          </mesh>
          <mesh position={[-1.15, 1.2, -1 + z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 4]} />
            <meshStandardMaterial color="#bbb" metalness={0.6} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Stern platform */}
      <mesh position={[0, 0.5, -3]}>
        <boxGeometry args={[2.3, 0.08, 1.5]} />
        <meshStandardMaterial color="#8b6914" roughness={0.9} />
      </mesh>
    </group>
  );
}

// Heavy Machinery — forklift-like equipment
function Forklift({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Body */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[1.2, 1.2, 2]} />
        <meshStandardMaterial color="#dd8800" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Cabin frame */}
      <mesh position={[0, 1.8, -0.2]} castShadow>
        <boxGeometry args={[1.2, 1.2, 1.4]} />
        <meshStandardMaterial color="#333" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* Mast */}
      <mesh position={[0, 1.2, 1.1]} castShadow>
        <boxGeometry args={[0.8, 2.4, 0.15]} />
        <meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Fork tines */}
      <mesh position={[-0.25, 0.15, 1.5]}>
        <boxGeometry args={[0.12, 0.08, 1.2]} />
        <meshStandardMaterial color="#555" metalness={0.8} />
      </mesh>
      <mesh position={[0.25, 0.15, 1.5]}>
        <boxGeometry args={[0.12, 0.08, 1.2]} />
        <meshStandardMaterial color="#555" metalness={0.8} />
      </mesh>
      {/* Wheels */}
      {[[-0.5, 0.25, -0.7], [0.5, 0.25, -0.7], [-0.5, 0.25, 0.5], [0.5, 0.25, 0.5]].map(([x, y, z], i) => (
        <mesh key={`fwheel-${i}`} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.25, 0.25, 0.15, 8]} />
          <meshStandardMaterial color="#111" roughness={0.9} />
        </mesh>
      ))}
      {/* Warning light */}
      <mesh position={[0, 2.5, -0.2]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

// Dock bollard
function DockBollard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 0.5, 8]} />
        <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.3, 0.2, 0.1, 8]} />
        <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

// Dock warehouse
function Warehouse({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Walls */}
      <mesh position={[0, 3, 0]} castShadow receiveShadow>
        <boxGeometry args={[10, 6, 14]} />
        <meshStandardMaterial color="#5a5a5a" roughness={0.8} />
      </mesh>
      {/* Roof — slightly peaked */}
      <mesh position={[0, 6.15, 0]} castShadow>
        <boxGeometry args={[10.5, 0.3, 14.5]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.3} />
      </mesh>
      {/* Large cargo door */}
      <mesh position={[0, 2, 7.01]}>
        <boxGeometry args={[5, 4, 0.05]} />
        <meshStandardMaterial color="#444" metalness={0.5} />
      </mesh>
      {/* Door track */}
      <mesh position={[0, 4.1, 7.01]}>
        <boxGeometry args={[5.5, 0.15, 0.1]} />
        <meshStandardMaterial color="#333" metalness={0.6} />
      </mesh>
      {/* Side windows */}
      {[-4, 0, 4].map((z, i) => (
        <React.Fragment key={`wwin-${i}`}>
          <mesh position={[5.01, 4, z]}>
            <boxGeometry args={[0.05, 1.5, 1.5]} />
            <meshStandardMaterial color="#88aabb" transparent opacity={0.4} />
          </mesh>
          <mesh position={[-5.01, 4, z]}>
            <boxGeometry args={[0.05, 1.5, 1.5]} />
            <meshStandardMaterial color="#88aabb" transparent opacity={0.4} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Loading dock light */}
      <pointLight position={[0, 5.5, 7.5]} intensity={2} color="#ffddaa" distance={12} />
    </group>
  );
}

// ─── BASE / CAMP STRUCTURES ──────────────────────────────────────────
// Military Tent
function MilitaryTent({ position, rotation = 0, isMedical = false }: { position: [number, number, number]; rotation?: number; isMedical?: boolean }) {
  const tentColor = isMedical ? '#e8e8e0' : '#5a634a';
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Tent body — ridge shape via two angled planes */}
      {/* Base platform */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[4.5, 0.04, 6]} />
        <meshStandardMaterial color="#6a5a3a" roughness={1} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-1.8, 1.2, 0]} rotation={[0, 0, 0.35]} castShadow>
        <boxGeometry args={[0.04, 2.6, 6]} />
        <meshStandardMaterial color={tentColor} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Right wall */}
      <mesh position={[1.8, 1.2, 0]} rotation={[0, 0, -0.35]} castShadow>
        <boxGeometry args={[0.04, 2.6, 6]} />
        <meshStandardMaterial color={tentColor} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Ridge pole */}
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[0.08, 0.08, 6.5]} />
        <meshStandardMaterial color="#3a3020" />
      </mesh>
      {/* Front flap frame */}
      <mesh position={[0, 1.25, 3.01]}>
        <boxGeometry args={[3.6, 2.5, 0.02]} />
        <meshStandardMaterial color={tentColor} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 1.25, -3.01]}>
        <boxGeometry args={[3.6, 2.5, 0.02]} />
        <meshStandardMaterial color={tentColor} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Support poles at corners */}
      {[[-2, 3], [-2, -3], [2, 3], [2, -3]].map(([x, z], i) => (
        <mesh key={`tpole-${i}`} position={[x, 1.1, z]}>
          <cylinderGeometry args={[0.04, 0.04, 2.2, 4]} />
          <meshStandardMaterial color="#3a3020" />
        </mesh>
      ))}
      {/* Guy ropes (angled) */}
      {[[-2.8, 3.5], [-2.8, -3.5], [2.8, 3.5], [2.8, -3.5]].map(([x, z], i) => (
        <mesh key={`rope-${i}`} position={[x * 0.7, 1.0, z * 0.7]} rotation={[z > 0 ? -0.4 : 0.4, 0, x > 0 ? 0.6 : -0.6]}>
          <cylinderGeometry args={[0.01, 0.01, 2, 4]} />
          <meshStandardMaterial color="#8a7a5a" />
        </mesh>
      ))}
      {/* Medical cross on the front if medical */}
      {isMedical && (
        <group position={[0, 1.8, 3.03]}>
          <mesh>
            <boxGeometry args={[0.6, 0.15, 0.01]} />
            <meshStandardMaterial color="#cc0000" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.15, 0.6, 0.01]} />
            <meshStandardMaterial color="#cc0000" />
          </mesh>
        </group>
      )}
      {/* Interior light */}
      <pointLight position={[0, 2, 0]} intensity={0.8} color="#ffddaa" distance={8} />
    </group>
  );
}

// Field Cot / Camp Bed
function CampBed({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Frame */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.8, 0.05, 2]} />
        <meshStandardMaterial color="#5a5a5a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Legs */}
      {[[-0.35, -0.85], [-0.35, 0.85], [0.35, -0.85], [0.35, 0.85]].map(([x, z], i) => (
        <mesh key={`bleg-${i}`} position={[x, 0.15, z]}>
          <cylinderGeometry args={[0.025, 0.025, 0.3, 4]} />
          <meshStandardMaterial color="#555" metalness={0.6} />
        </mesh>
      ))}
      {/* Mattress */}
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[0.7, 0.08, 1.85]} />
        <meshStandardMaterial color="#8a9a7a" roughness={1} />
      </mesh>
      {/* Pillow */}
      <mesh position={[0, 0.44, 0.75]}>
        <boxGeometry args={[0.5, 0.06, 0.3]} />
        <meshStandardMaterial color="#c0c0b0" roughness={1} />
      </mesh>
      {/* Blanket (folded at foot) */}
      <mesh position={[0, 0.44, -0.7]}>
        <boxGeometry args={[0.65, 0.06, 0.4]} />
        <meshStandardMaterial color="#4a5a3a" roughness={1} />
      </mesh>
    </group>
  );
}

// Wooden House / Cabin
function WoodenHouse({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Floor platform */}
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[5, 0.2, 4]} />
        <meshStandardMaterial color="#6a5030" roughness={0.9} />
      </mesh>
      {/* Raised stilts */}
      {[[-2.2, -1.7], [-2.2, 1.7], [2.2, -1.7], [2.2, 1.7]].map(([x, z], i) => (
        <mesh key={`stilt-${i}`} position={[x, 0.1, z]}>
          <cylinderGeometry args={[0.12, 0.15, 0.3, 6]} />
          <meshStandardMaterial color="#4a3020" roughness={0.9} />
        </mesh>
      ))}
      {/* Walls */}
      <mesh position={[0, 1.7, -2]} castShadow>
        <boxGeometry args={[5, 2.6, 0.15]} />
        <meshStandardMaterial color="#7a6040" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.7, 2]} castShadow>
        <boxGeometry args={[5, 2.6, 0.15]} />
        <meshStandardMaterial color="#7a6040" roughness={0.85} />
      </mesh>
      <mesh position={[-2.5, 1.7, 0]} castShadow>
        <boxGeometry args={[0.15, 2.6, 4]} />
        <meshStandardMaterial color="#7a6040" roughness={0.85} />
      </mesh>
      <mesh position={[2.5, 1.7, 0]} castShadow>
        <boxGeometry args={[0.15, 2.6, 4]} />
        <meshStandardMaterial color="#7a6040" roughness={0.85} />
      </mesh>
      {/* Door frame */}
      <mesh position={[0, 1.2, 2.01]}>
        <boxGeometry args={[1.2, 2, 0.05]} />
        <meshStandardMaterial color="#4a3020" roughness={0.9} />
      </mesh>
      {/* Windows */}
      <mesh position={[2.51, 2.0, 0]}>
        <boxGeometry args={[0.05, 0.8, 0.8]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.35} />
      </mesh>
      <mesh position={[-2.51, 2.0, 0]}>
        <boxGeometry args={[0.05, 0.8, 0.8]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.35} />
      </mesh>
      {/* Roof */}
      <mesh position={[-1.5, 3.3, 0]} rotation={[0, 0, 0.35]} castShadow>
        <boxGeometry args={[3, 0.08, 4.6]} />
        <meshStandardMaterial color="#4a3a2a" roughness={0.9} />
      </mesh>
      <mesh position={[1.5, 3.3, 0]} rotation={[0, 0, -0.35]} castShadow>
        <boxGeometry args={[3, 0.08, 4.6]} />
        <meshStandardMaterial color="#4a3a2a" roughness={0.9} />
      </mesh>
      {/* Interior light */}
      <pointLight position={[0, 2.5, 0]} intensity={0.6} color="#ffddaa" distance={6} />
    </group>
  );
}

// Campfire
function Campfire({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Stone ring */}
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh key={`stone-${i}`} position={[Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6]}>
            <boxGeometry args={[0.2, 0.2, 0.2]} />
            <meshStandardMaterial color="#555" roughness={0.9} />
          </mesh>
        );
      })}
      {/* Logs */}
      <mesh position={[0, 0.1, 0]} rotation={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.8, 6]} />
        <meshStandardMaterial color="#3a2010" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.15, 0]} rotation={[0, -0.8, Math.PI / 6]}>
        <cylinderGeometry args={[0.05, 0.07, 0.7, 6]} />
        <meshStandardMaterial color="#3a2010" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[Math.PI / 4, 0.5, 0]}>
        <cylinderGeometry args={[0.04, 0.06, 0.6, 6]} />
        <meshStandardMaterial color="#2a1808" roughness={0.9} />
      </mesh>
      {/* Fire glow */}
      <pointLight position={[0, 0.5, 0]} intensity={3} color="#ff6600" distance={10} />
      {/* Ember glow mesh */}
      <mesh position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#ff4400" emissive="#ff4400" emissiveIntensity={2} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// Sandbag wall
function SandbagWall({ position, rotation = 0, length = 3 }: { position: [number, number, number]; rotation?: number; length?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {Array.from({ length: Math.floor(length) }).map((_, i) => (
        <group key={`sbag-${i}`} position={[i * 0.6 - (length * 0.3), 0, 0]}>
          {/* Bottom row */}
          <mesh position={[0, 0.15, 0]} castShadow>
            <boxGeometry args={[0.55, 0.25, 0.35]} />
            <meshStandardMaterial color="#8a7a5a" roughness={1} />
          </mesh>
          {/* Top row (offset) */}
          <mesh position={[0.15, 0.4, 0]} castShadow>
            <boxGeometry args={[0.55, 0.25, 0.35]} />
            <meshStandardMaterial color="#7a6a4a" roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Watchtower
function Watchtower({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Four corner posts */}
      {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z], i) => (
        <mesh key={`wtp-${i}`} position={[x, 3, z]} castShadow>
          <cylinderGeometry args={[0.1, 0.12, 6, 6]} />
          <meshStandardMaterial color="#4a3020" roughness={0.9} />
        </mesh>
      ))}
      {/* Platform */}
      <mesh position={[0, 5.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.15, 2.5]} />
        <meshStandardMaterial color="#5a4030" roughness={0.9} />
      </mesh>
      {/* Railing walls */}
      {[[-1.2, 0, 0, 2.5], [1.2, 0, 0, 2.5], [0, -1.2, 2.5, 0], [0, 1.2, 2.5, 0]].map(([x, z, w, d], i) => (
        <mesh key={`wtr-${i}`} position={[x, 6.1, z]} castShadow>
          <boxGeometry args={[w || 0.08, 1, d || 0.08]} />
          <meshStandardMaterial color="#5a634a" roughness={0.9} />
        </mesh>
      ))}
      {/* Roof */}
      <mesh position={[0, 7, 0]} castShadow>
        <boxGeometry args={[2.8, 0.08, 2.8]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      {/* Ladder */}
      <mesh position={[1.3, 3, 0]}>
        <boxGeometry args={[0.08, 6, 0.5]} />
        <meshStandardMaterial color="#4a3020" />
      </mesh>
      {/* Ladder rungs */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={`rung-${i}`} position={[1.3, 0.5 + i * 0.7, 0]}>
          <boxGeometry args={[0.04, 0.04, 0.45]} />
          <meshStandardMaterial color="#4a3020" />
        </mesh>
      ))}
      {/* Spotlight at top */}
      <pointLight position={[0, 6.5, 0]} intensity={1.5} color="#ffddbb" distance={20} />
    </group>
  );
}

// Ammo/Supply Crate
function SupplyCrate({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[1, 0.7, 0.7]} />
        <meshStandardMaterial color="#4a5a3a" roughness={0.8} />
      </mesh>
      {/* Metal corner brackets */}
      {[[-0.48, -0.33], [-0.48, 0.33], [0.48, -0.33], [0.48, 0.33]].map(([x, z], i) => (
        <mesh key={`cb-${i}`} position={[x, 0.4, z]}>
          <boxGeometry args={[0.06, 0.72, 0.06]} />
          <meshStandardMaterial color="#333" metalness={0.6} />
        </mesh>
      ))}
      {/* Stencil label (thin box) */}
      <mesh position={[0, 0.45, 0.36]}>
        <boxGeometry args={[0.5, 0.2, 0.01]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}


// ─── Instanced Foliage (Trees + Rocks) ──────────────────────────────
const InstancedFoliage = React.memo(({ foliage, terrainType }: { foliage: any[]; terrainType: string }) => {
  const treeCount = foliage.filter(f => f.type === 'tree').length;
  const rockCount = foliage.length - treeCount;

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const leafRef = useRef<THREE.InstancedMesh>(null);
  const rockRef = useRef<THREE.InstancedMesh>(null);

  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.15, 0.3, 5, 6), []);
  const leafGeo = useMemo(() => new THREE.ConeGeometry(2, 4, 6), []);
  const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);

  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3d2b1f' }), []);
  const leafMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: terrainType === 'shore' ? '#2d5a27' : '#1a3a1a',
        side: THREE.DoubleSide,
      }),
    [terrainType]
  );
  const rockMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.9 }), []);

  useEffect(() => {
    if (!trunkRef.current || !leafRef.current || !rockRef.current) return;

    let treeIdx = 0;
    let rockIdx = 0;
    const tempObj = new THREE.Object3D();

    foliage.forEach(item => {
      if (item.type === 'tree') {
        // Trunk — base at terrain height
        tempObj.position.set(item.position[0], item.position[1] + 2.5 * item.scale, item.position[2]);
        tempObj.rotation.set(0, 0, 0);
        tempObj.scale.set(item.scale, item.scale, item.scale);
        tempObj.updateMatrix();
        trunkRef.current!.setMatrixAt(treeIdx, tempObj.matrix);

        // Canopy — single cone per tree (much cheaper than 5 planes)
        tempObj.position.set(item.position[0], item.position[1] + 5.5 * item.scale, item.position[2]);
        tempObj.scale.set(item.scale * 1.2, item.scale, item.scale * 1.2);
        tempObj.updateMatrix();
        leafRef.current!.setMatrixAt(treeIdx, tempObj.matrix);

        treeIdx++;
      } else {
        // Rock — sits directly on terrain
        tempObj.position.set(item.position[0], item.position[1], item.position[2]);
        tempObj.rotation.set(item.scale * 0.5, item.scale * 1.2, 0);
        tempObj.scale.set(item.scale, item.scale * 0.7, item.scale);
        tempObj.updateMatrix();
        rockRef.current!.setMatrixAt(rockIdx, tempObj.matrix);
        rockIdx++;
      }
    });

    trunkRef.current.instanceMatrix.needsUpdate = true;
    leafRef.current.instanceMatrix.needsUpdate = true;
    rockRef.current.instanceMatrix.needsUpdate = true;

    trunkRef.current.computeBoundingSphere();
    leafRef.current.computeBoundingSphere();
    rockRef.current.computeBoundingSphere();
  }, [foliage, terrainType]);

  return (
    <>
      <instancedMesh ref={trunkRef} args={[trunkGeo, trunkMat, treeCount]} castShadow receiveShadow frustumCulled />
      <instancedMesh ref={leafRef} args={[leafGeo, leafMat, treeCount]} castShadow frustumCulled />
      <instancedMesh ref={rockRef} args={[rockGeo, rockMat, rockCount]} castShadow receiveShadow frustumCulled />
    </>
  );
});

// ─── Grass Patches (instanced billboards for ground detail) ─────────
const GrassPatches = React.memo(({ terrainType, quality }: { terrainType: string; quality: string }) => {
  if (quality === 'Low' || terrainType === 'prison' || terrainType === 'port' || terrainType === 'base') return null;

  const count = quality === 'Medium' ? 600 : quality === 'High' ? 1200 : 2000;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geo = useMemo(() => new THREE.PlaneGeometry(0.4, 0.6), []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: terrainType === 'shore' ? '#8a9a5a' : terrainType === 'volcanic' ? '#2a1a1a' : '#2a5a2a',
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      }),
    [terrainType]
  );

  useEffect(() => {
    if (!meshRef.current) return;
    const tempObj = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      const h = getTerrainHeight(x, z, terrainType);
      if (h < 0) continue; // don't place grass underwater

      tempObj.position.set(x, h + 0.25, z);
      tempObj.rotation.set(0, Math.random() * Math.PI, 0);
      tempObj.scale.set(0.8 + Math.random() * 0.6, 0.5 + Math.random(), 1);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [terrainType, count]);

  return <instancedMesh ref={meshRef} args={[geo, mat, count]} frustumCulled />;
});

// ─── Static Environment (assembled scene) ───────────────────────────
export const StaticEnvironment = React.memo(
  ({
    terrainType,
    foliage,
    structures,
    quality,
    locationName,
  }: {
    terrainType: string;
    foliage: any[];
    structures: any[];
    quality: string;
    locationName?: string;
  }) => {
    const shadowMapSize = quality === 'Ultra' ? 2048 : quality === 'High' ? 1024 : 512;
    const isVolcanic = terrainType === 'volcanic';
    const isLowQ = quality === 'Low';
    const isMedical = locationName?.toLowerCase().includes('medical') || false;

    // Aggressive fog on iGPU — hides unrendered geometry tightly
    const fogColor = isVolcanic ? '#1a0505' : terrainType === 'shore' ? '#aabbcc' : terrainType === 'port' ? '#667788' : terrainType === 'base' ? '#8a8060' : '#556655';
    const fogNear = isLowQ ? 25 : quality === 'Medium' ? 45 : 60;
    const fogFar = isLowQ ? 90 : quality === 'Medium' ? 200 : 300;

    return (
      <>
        <fog attach="fog" args={[fogColor, fogNear, fogFar]} />

        <Sky sunPosition={isVolcanic ? [0, -10, 0] : [100, 20, 100]} />
        {quality !== 'Low' && (
          <Stars radius={100} depth={50} count={quality === 'Medium' ? 800 : 2000} factor={4} saturation={0} fade speed={1} />
        )}

        <ambientLight intensity={isVolcanic ? 0.15 : isLowQ ? 0.7 : 0.5} />
        {/* Skip hemisphereLight on iGPU — ambient alone is sufficient and saves a shader pass */}
        {!isLowQ && (
          <hemisphereLight
            args={[isVolcanic ? '#220000' : '#87ceeb', isVolcanic ? '#110000' : '#2a4a1a', isVolcanic ? 0.3 : 0.6]}
          />
        )}
        <directionalLight
          position={[80, 150, 80]}
          intensity={isVolcanic ? 0.8 : isLowQ ? 1.2 : 1.8}
          color={isVolcanic ? '#ff4400' : '#fff5e6'}
          castShadow={!isLowQ}
          shadow-mapSize={[shadowMapSize, shadowMapSize]}
          shadow-camera-left={isLowQ ? -60 : -80}
          shadow-camera-right={isLowQ ? 60 : 80}
          shadow-camera-top={isLowQ ? 60 : 80}
          shadow-camera-bottom={isLowQ ? -60 : -80}
          shadow-camera-near={1}
          shadow-camera-far={300}
          shadow-bias={-0.0005}
        />

        <Terrain terrainType={terrainType} quality={quality} />
        <GrassPatches terrainType={terrainType} quality={quality} />

        {isVolcanic && (
          <group>
            <pointLight position={[0, 10, 0]} intensity={5} color="#ff4400" distance={80} />
            {structures.map(s => (
              <mesh key={`lava-${s.id}`} position={[s.position[0], -0.3, s.position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[4, 16]} />
                <meshBasicMaterial color="#ff2200" />
              </mesh>
            ))}
          </group>
        )}

        {(terrainType === 'jungle' || terrainType === 'shore' || terrainType === 'ruins') && (
          <InstancedFoliage foliage={foliage} terrainType={terrainType} />
        )}

        {terrainType === 'prison' &&
          structures.map(s => <PrisonStructure key={`prison-struct-${s.id}`} position={s.position} />)}

        {/* ─── PORT: Ships, cranes, containers, machinery ─────────── */}
        {terrainType === 'port' && (
          <group>
            {/* Dock edge (concrete pier wall) */}
            <mesh position={[0, 0.3, 60]} castShadow receiveShadow>
              <boxGeometry args={[200, 1, 2]} />
              <meshStandardMaterial color="#555" roughness={0.9} />
            </mesh>

            {/* Cargo ship docked at pier */}
            <DockedShip position={[15, -0.8, 72]} rotation={0} />

            {/* Yacht moored nearby */}
            <Yacht position={[-20, -0.3, 68]} rotation={0.15} />
            <Yacht position={[-35, -0.3, 70]} rotation={-0.1} />

            {/* Gantry cranes */}
            <DockCrane position={[10, 0, 50]} />
            <DockCrane position={[40, 0, 50]} />

            {/* Warehouse */}
            <Warehouse position={[-10, 0, 20]} rotation={0} />

            {/* Shipping containers scattered around */}
            <ShippingContainer position={[25, 0, 30]} rotation={0.3} color="#8b4513" />
            <ShippingContainer position={[30, 0, 20]} rotation={-0.1} color="#1a5566" />
            <ShippingContainer position={[25, 2.8, 30]} rotation={0.3} color="#cc6600" />
            <ShippingContainer position={[35, 0, 35]} rotation={0.8} color="#2a6633" />
            <ShippingContainer position={[-30, 0, 30]} rotation={1.2} color="#994444" />
            <ShippingContainer position={[-25, 0, 40]} rotation={0.5} color="#336699" />
            <ShippingContainer position={[-25, 2.8, 40]} rotation={0.5} color="#997733" />

            {/* Forklifts */}
            <Forklift position={[0, 0, 35]} rotation={0.5} />
            <Forklift position={[-15, 0, 45]} rotation={-0.8} />
            <Forklift position={[20, 0, 42]} rotation={1.2} />

            {/* Bollards along dock */}
            {[-40, -25, -10, 5, 20, 35, 45].map((x, i) => (
              <DockBollard key={`bol-${i}`} position={[x, 0, 58]} />
            ))}

            {/* Light poles */}
            {[-30, 0, 30].map((x, i) => (
              <group key={`lpole-${i}`} position={[x, 0, 45]}>
                <mesh position={[0, 4, 0]}>
                  <cylinderGeometry args={[0.08, 0.1, 8, 6]} />
                  <meshStandardMaterial color="#444" metalness={0.5} />
                </mesh>
                <pointLight position={[0, 8, 0]} intensity={2} color="#ffddbb" distance={20} />
              </group>
            ))}

            {/* Scattered structures from generation (make them crates) */}
            {structures.map(s => (
              <SupplyCrate key={`port-crate-${s.id}`} position={s.position} rotation={s.rotation} />
            ))}

            {/* Harbor water highlight */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.15, 80]}>
              <planeGeometry args={[200, 50]} />
              <meshStandardMaterial color="#1a5577" transparent opacity={0.8} roughness={0.05} metalness={0.4} />
            </mesh>
          </group>
        )}

        {/* ─── BASE: Tents, wooden houses, campfires, watchtowers ─── */}
        {terrainType === 'base' && (
          <group>
            {/* Central compound area */}
            {/* Military tents */}
            <MilitaryTent position={[-12, getTerrainHeight(-12, -10, 'base'), -10]} rotation={0.2} />
            <MilitaryTent position={[10, getTerrainHeight(10, -15, 'base'), -15]} rotation={-0.3} />
            <MilitaryTent position={[-5, getTerrainHeight(-5, 10, 'base'), 10]} rotation={0.8} />

            {/* Medical tent (special — with beds) */}
            {isMedical ? (
              <group>
                <MilitaryTent position={[0, getTerrainHeight(0, 0, 'base'), 0]} rotation={0} isMedical={true} />
                {/* Beds inside the medical tent */}
                <CampBed position={[-1.2, getTerrainHeight(0, 0, 'base') + 0.04, 0.5]} rotation={0} />
                <CampBed position={[1.2, getTerrainHeight(0, 0, 'base') + 0.04, 0.5]} rotation={0} />
                <CampBed position={[-1.2, getTerrainHeight(0, 0, 'base') + 0.04, -1.5]} rotation={0} />
                <CampBed position={[1.2, getTerrainHeight(0, 0, 'base') + 0.04, -1.5]} rotation={0} />

                {/* Second medical tent */}
                <MilitaryTent position={[8, getTerrainHeight(8, 5, 'base'), 5]} rotation={0.3} isMedical={true} />
                <CampBed position={[7, getTerrainHeight(8, 5, 'base') + 0.04, 5.5]} rotation={0.3} />
                <CampBed position={[9, getTerrainHeight(8, 5, 'base') + 0.04, 5.5]} rotation={0.3} />
              </group>
            ) : (
              <MilitaryTent position={[0, getTerrainHeight(0, 0, 'base'), 0]} rotation={0} />
            )}

            {/* Wooden houses */}
            <WoodenHouse position={[20, getTerrainHeight(20, 5, 'base'), 5]} rotation={0.5} />
            <WoodenHouse position={[-18, getTerrainHeight(-18, 12, 'base'), 12]} rotation={-0.4} />
            <WoodenHouse position={[15, getTerrainHeight(15, -20, 'base'), -20]} rotation={1.2} />

            {/* Campfires */}
            <Campfire position={[0, getTerrainHeight(0, -25, 'base'), -25]} />
            <Campfire position={[-8, getTerrainHeight(-8, 5, 'base'), 5]} />

            {/* Watchtowers at perimeter */}
            <Watchtower position={[30, getTerrainHeight(30, 30, 'base'), 30]} />
            <Watchtower position={[-30, getTerrainHeight(-30, -25, 'base'), -25]} />

            {/* Sandbag walls */}
            <SandbagWall position={[0, getTerrainHeight(0, -30, 'base'), -30]} rotation={0} length={6} />
            <SandbagWall position={[25, getTerrainHeight(25, 0, 'base'), 0]} rotation={Math.PI / 2} length={5} />
            <SandbagWall position={[-20, getTerrainHeight(-20, -5, 'base'), -5]} rotation={0.3} length={4} />

            {/* Supply crates scattered around */}
            {structures.map(s => (
              <SupplyCrate key={`base-crate-${s.id}`} position={s.position} rotation={s.rotation} />
            ))}

            {/* Flagpole */}
            <group position={[2, getTerrainHeight(2, -8, 'base'), -8]}>
              <mesh position={[0, 3, 0]}>
                <cylinderGeometry args={[0.04, 0.06, 6, 6]} />
                <meshStandardMaterial color="#555" metalness={0.5} />
              </mesh>
              {/* Flag */}
              <mesh position={[0.5, 5.5, 0]}>
                <boxGeometry args={[1, 0.6, 0.02]} />
                <meshStandardMaterial color="#3a4a2a" side={THREE.DoubleSide} />
              </mesh>
            </group>

            {/* Barbed wire coils on perimeter */}
            {Array.from({ length: 8 }).map((_, i) => {
              const angle = (i / 8) * Math.PI * 2;
              const bx = Math.cos(angle) * 38;
              const bz = Math.sin(angle) * 38;
              return (
                <mesh key={`barb-${i}`} position={[bx, getTerrainHeight(bx, bz, 'base') + 0.8, bz]} rotation={[Math.PI / 2, 0, angle]}>
                  <torusGeometry args={[0.4, 0.05, 6, 12]} />
                  <meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} />
                </mesh>
              );
            })}

            {/* Generator */}
            <group position={[5, getTerrainHeight(5, -12, 'base'), -12]}>
              <mesh position={[0, 0.5, 0]} castShadow>
                <boxGeometry args={[1.2, 0.8, 0.8]} />
                <meshStandardMaterial color="#3a5a3a" roughness={0.7} />
              </mesh>
              <mesh position={[-0.7, 0.6, 0]}>
                <cylinderGeometry args={[0.06, 0.06, 0.8, 6]} />
                <meshStandardMaterial color="#555" metalness={0.6} />
              </mesh>
              <pointLight position={[0, 1.2, 0]} intensity={0.5} color="#ffaa00" distance={5} />
            </group>
          </group>
        )}

        {terrainType === 'ruins' &&
          structures.map(s => (
            <group key={`ruin-struct-${s.id}`} position={s.position} rotation={[0, s.rotation, 0]}>
              <mesh position={[0, 0.5, 0]} castShadow>
                <boxGeometry args={[2, 1.5, 0.2]} />
                <meshStandardMaterial color="#444" />
              </mesh>
              <mesh position={[1, 0.2, 0.5]} rotation={[0.5, 0.5, 0]} castShadow>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
                <meshStandardMaterial color="#333" />
              </mesh>
              <mesh position={[-0.8, 0.1, 0.8]} rotation={[0, 0.8, 0]} castShadow>
                <boxGeometry args={[0.8, 0.2, 0.8]} />
                <meshStandardMaterial color="#333" />
              </mesh>
            </group>
          ))}
      </>
    );
  }
);

// ─── Charter Boat (Chapter 1 — Shipwreck Shore) ──────────────────────
// The boat Marcus arrives on before being captured by the Ironclad patrol.
// Positioned offshore on the water, gently bobbing.
export const BOAT_SPAWN_POSITION: [number, number, number] = [0, 0.6, 30];

export function CharterBoat() {
  const boatRef = useRef<THREE.Group>(null);

  // Gentle bob animation — runs inside the Three.js render loop
  useFrame((state) => {
    if (!boatRef.current) return;
    const t = state.clock.getElapsedTime();
    boatRef.current.position.y = -0.3 + Math.sin(t * 0.6) * 0.12;
    boatRef.current.rotation.z = Math.sin(t * 0.4) * 0.03;
    boatRef.current.rotation.x = Math.cos(t * 0.5) * 0.02;
  });

  return (
    <group ref={boatRef} position={BOAT_SPAWN_POSITION}>
      {/* Hull */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 1.2, 10]} />
        <meshStandardMaterial color="#5a3e28" roughness={0.9} />
      </mesh>
      {/* Hull bow taper */}
      <mesh position={[0, 0, 5]} rotation={[0, 0, 0]} castShadow>
        <coneGeometry args={[2, 3, 4]} />
        <meshStandardMaterial color="#5a3e28" roughness={0.9} />
      </mesh>
      {/* Deck */}
      <mesh position={[0, 0.65, 0]} receiveShadow>
        <boxGeometry args={[3.6, 0.1, 9.5]} />
        <meshStandardMaterial color="#7a6040" roughness={1.0} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.5, -1.5]} castShadow>
        <boxGeometry args={[2.5, 1.5, 3.5]} />
        <meshStandardMaterial color="#8a7055" roughness={0.8} />
      </mesh>
      {/* Cabin roof */}
      <mesh position={[0, 2.35, -1.5]}>
        <boxGeometry args={[2.7, 0.15, 3.7]} />
        <meshStandardMaterial color="#6a5a3a" roughness={0.9} />
      </mesh>
      {/* Cabin windows */}
      <mesh position={[1.26, 1.5, -1.5]}>
        <boxGeometry args={[0.05, 0.5, 0.7]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.6} />
      </mesh>
      <mesh position={[-1.26, 1.5, -1.5]}>
        <boxGeometry args={[0.05, 0.5, 0.7]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.6} />
      </mesh>
      {/* Mast */}
      <mesh position={[0, 3.5, 1]}>
        <cylinderGeometry args={[0.06, 0.08, 5, 6]} />
        <meshStandardMaterial color="#4a3020" roughness={0.9} />
      </mesh>
      {/* Boom */}
      <mesh position={[0.8, 2.5, 1]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 2, 6]} />
        <meshStandardMaterial color="#4a3020" roughness={0.9} />
      </mesh>
      {/* Railing posts */}
      {[-1.7, -0.5, 0.8, 2.0, 3.2].map((z, i) => (
        <React.Fragment key={`rail-${i}`}>
          <mesh position={[1.85, 1.1, z]}>
            <cylinderGeometry args={[0.04, 0.04, 0.9, 4]} />
            <meshStandardMaterial color="#888" metalness={0.5} />
          </mesh>
          <mesh position={[-1.85, 1.1, z]}>
            <cylinderGeometry args={[0.04, 0.04, 0.9, 4]} />
            <meshStandardMaterial color="#888" metalness={0.5} />
          </mesh>
        </React.Fragment>
      ))}
      {/* Railing top bar */}
      <mesh position={[1.85, 1.55, 0.75]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 5, 4]} />
        <meshStandardMaterial color="#888" metalness={0.5} />
      </mesh>
      <mesh position={[-1.85, 1.55, 0.75]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 5, 4]} />
        <meshStandardMaterial color="#888" metalness={0.5} />
      </mesh>
      {/* Equipment on deck: camera bag */}
      <mesh position={[0.5, 0.75, 2]} castShadow>
        <boxGeometry args={[0.4, 0.3, 0.5]} />
        <meshStandardMaterial color="#3a4a3a" roughness={1} />
      </mesh>
      {/* Stern light */}
      <pointLight position={[0, 1.5, -4.5]} intensity={0.8} color="#ffeecc" distance={8} />
    </group>
  );
}
