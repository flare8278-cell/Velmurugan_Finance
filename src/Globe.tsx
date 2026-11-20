import {useEffect, useRef, useState, type ReactElement} from 'react';
import * as THREE from 'three';
import earthTextureUrl from './assets/earth-natural-paty.png';

interface GlobeProps {
  motionAllowed?: boolean;
}

// Convert lat/long degrees to 3D Cartesian coordinates on sphere of radius R
function latLongToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

export function Globe({motionAllowed = true}: GlobeProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [webGlSupported, setWebGlSupported] = useState(true);

  // Check OS reduced-motion preference
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const initialMotion = motionAllowed && !prefersReduced;

  const [isPlaying, setIsPlaying] = useState(initialMotion);

  // References for live 3D interaction inside the render loop
  const autoRotateRef = useRef(initialMotion);
  const isDraggingRef = useRef(false);
  const previousPointerPositionRef = useRef({x: 0, y: 0});
  const rotationVelocityRef = useRef({x: 0, y: 0});
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const pinchStartDistRef = useRef<number | null>(null);

  // Synchronize rotation with motionAllowed and OS reduced-motion settings
  useEffect(() => {
    const active = motionAllowed && !prefersReduced;
    autoRotateRef.current = active;
    setIsPlaying(active);
  }, [motionAllowed, prefersReduced]);

  // Initialize Three.js WebGL scene
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
      });
    } catch {
      setWebGlSupported(false);
      return;
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 600;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    camera.position.z = 270;
    cameraRef.current = camera;

    const globeGroup = new THREE.Group();
    // Tilt globe slightly to feature Tamil Nadu / Indian Ocean region nicely
    globeGroup.rotation.x = 0.25;
    globeGroup.rotation.y = -1.35;
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const GLOBE_RADIUS = 72;

    // 1. Natural Earth 3D Sphere with bundled equirectangular texture in Paty palette
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(earthTextureUrl, () => {
      renderer.render(scene, camera);
    });
    earthTexture.colorSpace = THREE.SRGBColorSpace;

    const earthGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const earthMat = new THREE.MeshBasicMaterial({
      map: earthTexture,
      color: 0xffffff
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    globeGroup.add(earthMesh);

    // 2. Subtle atmospheric rim glow mesh slightly above globe surface
    const rimGeo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.4, 48, 48);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.08
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    globeGroup.add(rimMesh);

    // 3. Financial Network Connection Arcs & Hubs
    const hubs = [
      {name: 'Velmurugan Hub', lat: 11.6643, lon: 78.146},
      {name: 'Chennai', lat: 13.0827, lon: 80.2707},
      {name: 'Coimbatore', lat: 11.0168, lon: 76.9558},
      {name: 'Madurai', lat: 9.9252, lon: 78.1198},
      {name: 'Bengaluru', lat: 12.9716, lon: 77.5946},
      {name: 'Mumbai', lat: 19.076, lon: 72.8777},
      {name: 'Singapore', lat: 1.3521, lon: 103.8198},
      {name: 'Dubai', lat: 25.2048, lon: 55.2708},
      {name: 'London', lat: 51.5074, lon: -0.1278}
    ];

    const centerHub = hubs[0];
    const centerVec = latLongToVector3(centerHub.lat, centerHub.lon, GLOBE_RADIUS);

    // Center Hub Marker: Pulsing Gold Ring & Dot
    const markerGeo = new THREE.RingGeometry(1.5, 3.4, 32);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xe3bd70,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const markerMesh = new THREE.Mesh(markerGeo, markerMat);
    markerMesh.position.copy(centerVec);
    markerMesh.lookAt(centerVec.clone().multiplyScalar(2));
    globeGroup.add(markerMesh);

    const hubDotGeo = new THREE.SphereGeometry(1.7, 16, 16);
    const hubDotMat = new THREE.MeshBasicMaterial({color: 0xfff6cf});
    const hubDotMesh = new THREE.Mesh(hubDotGeo, hubDotMat);
    hubDotMesh.position.copy(centerVec);
    globeGroup.add(hubDotMesh);

    // Secondary Hub Markers (Cyan/Gold Pins on Natural Earth Cities)
    const secondaryHubGeo = new THREE.SphereGeometry(1.0, 12, 12);
    const secondaryHubMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.9
    });
    const secondaryHubMeshes: THREE.Mesh[] = [];

    const arcMaterials: THREE.LineBasicMaterial[] = [];
    const arcs: THREE.Line[] = [];

    for (let h = 1; h < hubs.length; h++) {
      const targetVec = latLongToVector3(hubs[h].lat, hubs[h].lon, GLOBE_RADIUS);

      const secMesh = new THREE.Mesh(secondaryHubGeo, secondaryHubMat);
      secMesh.position.copy(targetVec);
      globeGroup.add(secMesh);
      secondaryHubMeshes.push(secMesh);

      const midVec = new THREE.Vector3().addVectors(centerVec, targetVec).multiplyScalar(0.5);
      const dist = centerVec.distanceTo(targetVec);
      const elevation = GLOBE_RADIUS + dist * 0.28;
      midVec.normalize().multiplyScalar(elevation);

      const curve = new THREE.QuadraticBezierCurve3(centerVec, midVec, targetVec);
      const points = curve.getPoints(40);
      const arcGeo = new THREE.BufferGeometry().setFromPoints(points);

      const arcMat = new THREE.LineBasicMaterial({
        color: h <= 4 ? 0xe3bd70 : 0x38bdf8,
        transparent: true,
        opacity: 0.65
      });
      arcMaterials.push(arcMat);
      const arcLine = new THREE.Line(arcGeo, arcMat);
      arcs.push(arcLine);
      globeGroup.add(arcLine);
    }

    // 4. Outer Atmospheric Glow Ring
    const haloGeo = new THREE.RingGeometry(GLOBE_RADIUS + 0.5, GLOBE_RADIUS + 15, 64);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.18
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI / 2;
    globeGroup.add(haloMesh);

    // 5. Floating Ambient Dust Particles in Background
    const dustCount = 180;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount * 3; i += 3) {
      dustPositions[i] = (Math.random() - 0.5) * 500;
      dustPositions[i + 1] = (Math.random() - 0.5) * 500;
      dustPositions[i + 2] = (Math.random() - 0.5) * 300 - 50;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 1.6,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35
    });
    const dustParticles = new THREE.Points(dustGeo, dustMat);
    scene.add(dustParticles);

    // Non-passive wheel event listener for smooth zoom
    const onCanvasWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!cameraRef.current) return;
      const zoomDelta = e.deltaY * 0.15;
      const newZ = Math.max(160, Math.min(420, cameraRef.current.position.z + zoomDelta));
      cameraRef.current.position.z = newZ;
    };

    // Pinch-to-zoom touch support
    const onCanvasTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistRef.current = Math.hypot(dx, dy);
      }
    };

    const onCanvasTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistRef.current !== null && cameraRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        const diff = pinchStartDistRef.current - currentDist;
        pinchStartDistRef.current = currentDist;

        const newZ = Math.max(160, Math.min(420, cameraRef.current.position.z + diff * 0.8));
        cameraRef.current.position.z = newZ;
      }
    };

    const onCanvasTouchEnd = () => {
      pinchStartDistRef.current = null;
    };

    canvas.addEventListener('wheel', onCanvasWheel, {passive: false});
    canvas.addEventListener('touchstart', onCanvasTouchStart, {passive: true});
    canvas.addEventListener('touchmove', onCanvasTouchMove, {passive: true});
    canvas.addEventListener('touchend', onCanvasTouchEnd, {passive: true});

    // Animation & Render Loop with automatic smooth rotation & pulse
    let animId = 0;
    let pulseTime = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (!isDraggingRef.current) {
        if (autoRotateRef.current) {
          // Continuous, majestic auto-rotation + inertia blending
          globeGroup.rotation.y += 0.0028 + rotationVelocityRef.current.y;
          globeGroup.rotation.x += rotationVelocityRef.current.x;
          rotationVelocityRef.current.x *= 0.92;
          rotationVelocityRef.current.y *= 0.92;
        } else {
          globeGroup.rotation.y += rotationVelocityRef.current.y;
          globeGroup.rotation.x += rotationVelocityRef.current.x;
          rotationVelocityRef.current.x *= 0.92;
          rotationVelocityRef.current.y *= 0.92;
        }
      }

      if (autoRotateRef.current) {
        pulseTime += 0.04;
        const scale = 1 + Math.sin(pulseTime) * 0.22;
        markerMesh.scale.set(scale, scale, 1);
        dustParticles.rotation.y += 0.0004;
      }

      renderer.render(scene, camera);
    };

    animate();

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const {width: newWidth, height: newHeight} = entry.contentRect;
        if (newWidth > 0 && newHeight > 0) {
          camera.aspect = newWidth / newHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, newHeight);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();

      canvas.removeEventListener('wheel', onCanvasWheel);
      canvas.removeEventListener('touchstart', onCanvasTouchStart);
      canvas.removeEventListener('touchmove', onCanvasTouchMove);
      canvas.removeEventListener('touchend', onCanvasTouchEnd);

      earthGeo.dispose();
      earthMat.dispose();
      earthTexture.dispose();
      rimGeo.dispose();
      rimMat.dispose();
      secondaryHubGeo.dispose();
      secondaryHubMat.dispose();
      markerGeo.dispose();
      markerMat.dispose();
      hubDotGeo.dispose();
      hubDotMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();

      for (const mat of arcMaterials) mat.dispose();
      for (const line of arcs) line.geometry.dispose();

      renderer.dispose();
    };
  }, []);

  // Pointer event handlers for drag rotate
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    previousPointerPositionRef.current = {x: e.clientX, y: e.clientY};
    rotationVelocityRef.current = {x: 0, y: 0};
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !globeGroupRef.current) return;
    const deltaX = e.clientX - previousPointerPositionRef.current.x;
    const deltaY = e.clientY - previousPointerPositionRef.current.y;

    const rotSpeed = 0.0055;
    globeGroupRef.current.rotation.y += deltaX * rotSpeed;
    globeGroupRef.current.rotation.x += deltaY * rotSpeed;

    globeGroupRef.current.rotation.x = Math.max(-1.2, Math.min(1.2, globeGroupRef.current.rotation.x));

    rotationVelocityRef.current = {
      x: deltaY * rotSpeed * 0.4,
      y: deltaX * rotSpeed * 0.4
    };

    previousPointerPositionRef.current = {x: e.clientX, y: e.clientY};
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!globeGroupRef.current || !cameraRef.current) return;
    const step = 0.08;
    switch (e.key) {
      case 'ArrowLeft':
        globeGroupRef.current.rotation.y -= step;
        break;
      case 'ArrowRight':
        globeGroupRef.current.rotation.y += step;
        break;
      case 'ArrowUp':
        globeGroupRef.current.rotation.x = Math.max(-1.2, globeGroupRef.current.rotation.x - step);
        break;
      case 'ArrowDown':
        globeGroupRef.current.rotation.x = Math.min(1.2, globeGroupRef.current.rotation.x + step);
        break;
      case '+':
      case '=':
        if (cameraRef.current) {
          cameraRef.current.position.z = Math.max(160, cameraRef.current.position.z - 30);
        }
        break;
      case '-':
      case '_':
        if (cameraRef.current) {
          cameraRef.current.position.z = Math.min(420, cameraRef.current.position.z + 30);
        }
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className="interactive-globe-container"
      tabIndex={0}
      role="region"
      aria-label="Interactive 3D Velmurugan Finance Network Globe"
      onKeyDown={handleKeyDown}
    >
      {webGlSupported ? (
        <>
          <canvas
            ref={canvasRef}
            className="interactive-globe-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="globe-toolbar" role="toolbar" aria-label="3D Globe controls">
            <button
              type="button"
              className="globe-tool-btn"
              onClick={() => {
                autoRotateRef.current = !autoRotateRef.current;
                setIsPlaying(autoRotateRef.current);
              }}
              aria-label={isPlaying ? 'Pause rotation' : 'Resume rotation'}
              title={isPlaying ? 'Pause rotation' : 'Resume rotation'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="globe-tool-btn"
              onClick={() => {
                if (cameraRef.current) {
                  cameraRef.current.position.z = Math.max(160, cameraRef.current.position.z - 30);
                }
              }}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="globe-tool-btn"
              onClick={() => {
                if (cameraRef.current) {
                  cameraRef.current.position.z = Math.min(420, cameraRef.current.position.z + 30);
                }
              }}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="globe-tool-btn"
              onClick={() => {
                if (globeGroupRef.current && cameraRef.current) {
                  globeGroupRef.current.rotation.set(0.25, -1.35, 0);
                  cameraRef.current.position.z = 270;
                }
              }}
              aria-label="Reset view"
              title="Reset view"
            >
              ↺
            </button>
          </div>
        </>
      ) : (
        <div className="globe-fallback">
          <div className="globe-fallback-sphere" />
          <p className="globe-fallback-text">Velmurugan Finance Network</p>
        </div>
      )}
    </div>
  );
}

export default Globe;
