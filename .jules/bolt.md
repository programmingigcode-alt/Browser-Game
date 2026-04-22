## 2025-05-15 - [Particle Pooling & Terrain Caching]
**Learning:** High-frequency allocations (new Vector3, filter() on arrays) in R3F useFrame loops and repeated FBM noise calculations for terrain height are primary bottlenecks for frame consistency.
**Action:** Always use fixed-size object pools and InstancedMesh for particles. Implement spatial caching for terrain height lookups when multiple systems (AI, particles, player) are active.

## 2025-05-15 - [React Re-render Throttling]
**Learning:** High-frequency gameplay state (stealth, shake) triggers full-app re-renders via the root App component.
**Action:** Use React.memo with custom comparison functions for UI components like HUD, and implement update thresholds (delta checks) before calling setState for smooth animations that don't need frame-perfect UI precision.
