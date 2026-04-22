import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// --- Reusable Math Objects to avoid allocations ---
const tempObj = new THREE.Object3D();
const tempColor = new THREE.Color();
const tempVel = new THREE.Vector3();

// Particle structure for pool
class ParticleData {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  life = 0;
  maxLife = 0;
  active = false;
}

// ─── Blood splatter particles ───────────────────────────────────────
export function BloodParticles({ quality, density }: { quality: string, density: number }) {
  const maxParticles = useMemo(() => {
    const base = quality === 'Low' ? 40 : quality === 'Medium' ? 80 : 160;
    return Math.max(1, Math.floor(base * (density / 100)));
  }, [quality, density]);

  const pool = useRef<ParticleData[]>([]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const nextIdx = useRef(0);

  // Initialize pool once
  if (pool.current.length === 0) {
    pool.current = Array.from({ length: 400 }, () => new ParticleData());
  }

  useEffect(() => {
    const handleBlood = (e: any) => {
      const pos = e.detail.position;
      const count = Math.max(1, Math.floor((quality === 'Low' ? 4 : quality === 'Medium' ? 8 : 12) * (density / 100)));

      for (let i = 0; i < count; i++) {
        const p = pool.current[nextIdx.current];
        p.position.set(pos[0], pos[1], pos[2]);
        p.velocity.set(
          (Math.random() - 0.5) * 4,
          Math.random() * 3,
          (Math.random() - 0.5) * 4
        );
        p.life = 1.0;
        p.maxLife = 0.5 + Math.random() * 0.5;
        p.active = true;
        nextIdx.current = (nextIdx.current + 1) % maxParticles;
      }
    };
    window.addEventListener('blood-splatter', handleBlood);
    return () => window.removeEventListener('blood-splatter', handleBlood);
  }, [quality, density, maxParticles]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.1);
    
    for (let i = 0; i < maxParticles; i++) {
      const p = pool.current[i];
      if (!p.active) {
        tempObj.position.set(0, -100, 0);
        tempObj.scale.set(0, 0, 0);
        tempObj.updateMatrix();
        meshRef.current.setMatrixAt(i, tempObj.matrix);
        continue;
      }

      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        p.active = false;
        tempObj.position.set(0, -100, 0);
        tempObj.scale.set(0, 0, 0);
        tempObj.updateMatrix();
        meshRef.current.setMatrixAt(i, tempObj.matrix);
        continue;
      }

      p.velocity.y -= 9.8 * dt; // gravity
      tempVel.copy(p.velocity).multiplyScalar(dt);
      p.position.add(tempVel);

      tempObj.position.copy(p.position);
      const scale = p.life * 0.08;
      tempObj.scale.set(scale, scale, scale);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);

      tempColor.setHSL(0, 1, 0.15 + p.life * 0.35);
      meshRef.current.setColorAt(i, tempColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  const geo = useMemo(() => new THREE.SphereGeometry(1, 4, 4), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#cc0000' }), []);

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, maxParticles]} frustumCulled={false} />
  );
}

// ─── Shell casing particles ─────────────────────────────────────────
export function ShellParticles({ quality, density }: { quality: string, density: number }) {
  const maxParticles = useMemo(() => {
    if (quality === 'Low' || density === 0) return 0;
    const base = quality === 'Medium' ? 20 : 40;
    return Math.max(1, Math.floor(base * (density / 100)));
  }, [quality, density]);
  
  const pool = useRef<ParticleData[]>([]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const nextIdx = useRef(0);

  if (pool.current.length === 0) {
    pool.current = Array.from({ length: 100 }, () => new ParticleData());
  }

  useEffect(() => {
    if (maxParticles === 0) return;
    const handleShell = (e: any) => {
      const pos = e.detail.position;
      const p = pool.current[nextIdx.current];
      p.position.set(pos[0], pos[1], pos[2]);
      p.velocity.set(
        (Math.random() - 0.5) * 2 + 1,
        Math.random() * 2 + 1,
        (Math.random() - 0.5) * 2
      );
      p.life = 1.0;
      p.maxLife = 2.0;
      p.active = true;
      nextIdx.current = (nextIdx.current + 1) % maxParticles;
    };
    window.addEventListener('shell-eject', handleShell);
    return () => window.removeEventListener('shell-eject', handleShell);
  }, [maxParticles]);

  useFrame((_, delta) => {
    if (!meshRef.current || maxParticles === 0) return;
    const dt = Math.min(delta, 0.1);
    
    for (let i = 0; i < maxParticles; i++) {
      const p = pool.current[i];
      if (!p.active) {
        tempObj.position.set(0, -100, 0);
        tempObj.updateMatrix();
        meshRef.current.setMatrixAt(i, tempObj.matrix);
        continue;
      }

      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      if (p.position.y > 0.05) {
        p.velocity.y -= 9.8 * dt;
        tempVel.copy(p.velocity).multiplyScalar(dt);
        p.position.add(tempVel);
      } else {
        p.position.y = 0.05;
        p.velocity.set(0, 0, 0);
      }

      tempObj.position.copy(p.position);
      tempObj.rotation.set(p.life * 10, p.life * 5, 0);
      tempObj.scale.set(0.03, 0.03, 0.06);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  const geo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c4a000', metalness: 0.9, roughness: 0.3 }), []);

  if (maxParticles === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geo, mat, maxParticles]} frustumCulled={false} />
  );
}

// ─── Muzzle smoke ───────────────────────────────────────────────────
export function MuzzleSmokeParticles({ quality, density }: { quality: string, density: number }) {
  const maxParticles = useMemo(() => {
    if (quality === 'Low' || density === 0) return 0;
    const base = quality === 'Medium' ? 30 : 60;
    return Math.max(1, Math.floor(base * (density / 100)));
  }, [quality, density]);

  const pool = useRef<ParticleData[]>([]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const nextIdx = useRef(0);

  if (pool.current.length === 0) {
    pool.current = Array.from({ length: 100 }, () => new ParticleData());
  }

  useEffect(() => {
    if (maxParticles === 0) return;
    const handleSmoke = (e: any) => {
      const pos = e.detail.position;
      const count = Math.max(1, Math.floor((quality === 'Medium' ? 3 : 5) * (density / 100)));
      for (let i = 0; i < count; i++) {
        const p = pool.current[nextIdx.current];
        p.position.set(pos[0], pos[1], pos[2]);
        p.velocity.set(
          (Math.random() - 0.5) * 0.5,
          Math.random() * 0.5 + 0.2,
          (Math.random() - 0.5) * 0.5
        );
        p.life = 1.0;
        p.maxLife = 0.3 + Math.random() * 0.3;
        p.active = true;
        nextIdx.current = (nextIdx.current + 1) % maxParticles;
      }
    };
    window.addEventListener('muzzle-smoke', handleSmoke);
    return () => window.removeEventListener('muzzle-smoke', handleSmoke);
  }, [quality, density, maxParticles]);

  useFrame((_, delta) => {
    if (!meshRef.current || maxParticles === 0) return;
    const dt = Math.min(delta, 0.1);
    
    for (let i = 0; i < maxParticles; i++) {
      const p = pool.current[i];
      if (!p.active) {
        tempObj.position.set(0, -100, 0);
        tempObj.updateMatrix();
        meshRef.current.setMatrixAt(i, tempObj.matrix);
        continue;
      }

      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      tempVel.copy(p.velocity).multiplyScalar(dt);
      p.position.add(tempVel);

      tempObj.position.copy(p.position);
      const scale = (1 - p.life) * 0.15 + 0.02;
      tempObj.scale.set(scale, scale, scale);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  const geo = useMemo(() => new THREE.SphereGeometry(1, 6, 6), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#888888', transparent: true, opacity: 0.3 }), []);

  if (maxParticles === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geo, mat, maxParticles]} frustumCulled={false} />
  );
}
