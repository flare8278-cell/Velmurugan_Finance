import {useEffect, useRef, useState} from 'react';

export function Globe() {
  const bgRef = useRef<HTMLDivElement>(null);
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });
  const [statusText, setStatusText] = useState('Animated globe');

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const bg = bgRef.current;
    const videoA = videoARef.current;
    const videoB = videoBRef.current;
    const canvas = canvasRef.current;
    if (!bg || !videoA || !videoB || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleReduceChange = (e: MediaQueryListEvent) => {
      setPaused(e.matches);
    };
    reduce.addEventListener('change', handleReduceChange);

    let cur = videoA;
    let nxt = videoB;
    let swapping = false;
    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let lastFrame = 0;
    let angle = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let lastVideoTime = -1;
    let lastProgress = 0;

    const points: {x: number; y: number; z: number; land: boolean}[] = [];
    const stars: [number, number, number][] = [];

    for (let lat = -84; lat <= 84; lat += 3) {
      const count = Math.max(8, Math.round(120 * Math.cos((lat * Math.PI) / 180)));
      for (let j = 0; j < count; j++) {
        const lon = (j / count) * Math.PI * 2;
        const l = (lat * Math.PI) / 180;
        const texture = Math.sin(lon * 3 + l * 4) + Math.cos(lon * 5 - l * 2) + Math.sin(lon * 2 - l * 7);
        points.push({
          x: Math.cos(l) * Math.sin(lon),
          y: Math.sin(l),
          z: Math.cos(l) * Math.cos(lon),
          land: texture > 0.45
        });
      }
    }

    let randomSeed = 37;
    const random = () => {
      randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
      return randomSeed / 4294967296;
    };
    for (let i = 0; i < 130; i++) stars.push([random(), random(), random()]);

    const size = () => {
      if (!bg || !canvas) return;
      const r = bg.getBoundingClientRect();
      width = r.width || window.innerWidth;
      height = r.height || window.innerHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      draw();
    };

    const draw = () => {
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      for (const [x, y, a] of stars) {
        ctx.fillStyle = 'rgba(222,205,255,' + (0.12 + a * 0.6) + ')';
        ctx.fillRect(x * width, y * height, 1 + a, 1 + a);
      }

      const cx = width * 0.5;
      const cy = height * 0.79;
      const r = Math.min(width * 0.46, height * 0.77);

      const halo = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r * 1.06);
      halo.addColorStop(0, '#130824');
      halo.addColorStop(0.78, '#391265');
      halo.addColorStop(0.91, '#a671ed');
      halo.addColorStop(0.94, '#32124c');
      halo.addColorStop(1, '#0000');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2);
      ctx.fill();

      const globe = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.5, 0, cx, cy, r);
      globe.addColorStop(0, '#28113f');
      globe.addColorStop(0.55, '#10091d');
      globe.addColorStop(1, '#020104');
      ctx.fillStyle = globe;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      const cs = Math.cos(angle);
      const sn = Math.sin(angle);
      const tilt = 0.16;

      for (const p of points) {
        const x = p.x * cs + p.z * sn;
        const z = p.z * cs - p.x * sn;
        const y = p.y;
        if (z < 0) continue;
        const py = y * Math.cos(tilt) - z * Math.sin(tilt);
        ctx.fillStyle =
          'rgba(' +
          (p.land ? '182,121,255,' : '112,63,177,') +
          (0.12 + z * (p.land ? 0.8 : 0.35)) +
          ')';
        const radius = (p.land ? 1.25 : 0.7) * Math.max(0.55, r / 550) * (0.5 + z * 0.7);
        ctx.beginPath();
        ctx.arc(cx + x * r, cy - py * r, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = '#a477d14d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.2, r * 0.15, -0.18, 0, Math.PI * 2);
      ctx.stroke();
    };

    const fallback = (on: boolean) => {
      if (!bg) return;
      bg.classList.toggle('use-fallback', on);
      setStatusText(
        pausedRef.current
          ? 'Animation paused'
          : on
          ? 'Animated globe · video buffering'
          : 'Original globe video'
      );
    };

    const play = (v: HTMLVideoElement) => {
      v.muted = true;
      const promise = v.play();
      if (promise) promise.catch(() => fallback(true));
    };

    const stopVideos = () => {
      videoA?.pause();
      videoB?.pause();
    };

    const clearSwap = () => {
      if (swapTimer) clearTimeout(swapTimer);
      swapping = false;
    };

    const crossfade = () => {
      if (
        pausedRef.current ||
        swapping ||
        cur.readyState < 3 ||
        !Number.isFinite(cur.duration) ||
        cur.duration - cur.currentTime > 0.9
      )
        return;
      if (nxt.readyState < 3) {
        fallback(true);
        return;
      }
      swapping = true;
      const out = cur;
      try {
        nxt.currentTime = 0;
      } catch {}
      play(nxt);
      nxt.classList.add('is-active');
      out.classList.remove('is-active');
      const temp = cur;
      cur = nxt;
      nxt = temp;
      lastVideoTime = -1;
      swapTimer = setTimeout(() => {
        out.pause();
        try {
          out.currentTime = 0;
        } catch {}
        swapping = false;
      }, 1000);
    };

    const frame = (now: number) => {
      raf = 0;
      if (document.hidden || pausedRef.current) return;
      const delta = lastFrame ? Math.min(50, now - lastFrame) : 0;
      lastFrame = now;
      angle -= delta * 0.000055;
      if (cur.currentTime !== lastVideoTime) {
        lastVideoTime = cur.currentTime;
        lastProgress = now;
      }
      const available = cur.readyState >= 3 && !cur.paused && now - lastProgress < 1300;
      fallback(!available);
      if (!available) draw();
      crossfade();
      raf = requestAnimationFrame(frame);
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      lastFrame = 0;
      if (pausedRef.current || document.hidden) {
        stopVideos();
        if (pausedRef.current) {
          setStatusText('Animation paused');
          draw();
        }
        return;
      }
      play(cur);
      lastProgress = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const onWaiting = () => {
      if (!pausedRef.current) fallback(true);
    };
    const onError = () => {
      fallback(true);
    };
    const onPlaying = () => {
      if (!pausedRef.current) {
        lastProgress = performance.now();
        fallback(false);
      }
    };

    videoA.addEventListener('waiting', onWaiting);
    videoA.addEventListener('error', onError);
    videoA.addEventListener('playing', onPlaying);
    videoB.addEventListener('waiting', onWaiting);
    videoB.addEventListener('error', onError);
    videoB.addEventListener('playing', onPlaying);

    const onVisibility = () => {
      clearSwap();
      sync();
    };
    const onResize = () => {
      size();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    size();
    sync();

    return () => {
      cancelAnimationFrame(raf);
      clearSwap();
      stopVideos();
      reduce.removeEventListener('change', handleReduceChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      videoA?.removeEventListener('waiting', onWaiting);
      videoA?.removeEventListener('error', onError);
      videoA?.removeEventListener('playing', onPlaying);
      videoB?.removeEventListener('waiting', onWaiting);
      videoB?.removeEventListener('error', onError);
      videoB?.removeEventListener('playing', onPlaying);
    };
  }, [paused]);

  return (
    <div className="globe-container">
      <div
        className="bg use-fallback"
        ref={bgRef}
        role="img"
        aria-label="Purple dot matrix globe rotating against a starfield"
      >
        <video
          ref={videoARef}
          className="bg-video is-active"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          poster="https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/82e7eb75-c65f-490a-99b5-f3d1cad54200.webp"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_104036_bd6924f6-3c8e-417e-8465-6d03c8c2e9e6.mp4"
            type="video/mp4"
          />
        </video>
        <video
          ref={videoBRef}
          className="bg-video"
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          poster="https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/82e7eb75-c65f-490a-99b5-f3d1cad54200.webp"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260912_104036_bd6924f6-3c8e-417e-8465-6d03c8c2e9e6.mp4"
            type="video/mp4"
          />
        </video>
        <canvas ref={canvasRef} className="globe-fallback" aria-hidden="true" />
      </div>
      <div className="globe-controls">
        <span className="motion-status">{statusText}</span>
        <button
          type="button"
          className="motion-control"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? 'Play globe animation' : 'Pause globe animation'}
        >
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
      </div>
    </div>
  );
}
