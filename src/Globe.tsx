import {useState} from 'react';

export function Globe() {
  const [failed, setFailed] = useState(false);

  return (
    <div className="interactive-globe-container" aria-hidden="true" style={{pointerEvents: 'none'}}>
      {failed ? (
        <img className="login-earth-video" src="/earth-rotating-poster.jpg" alt="" />
      ) : (
        <video
          className="login-earth-video"
          src="/earth-rotating.mp4"
          poster="/earth-rotating-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export default Globe;
