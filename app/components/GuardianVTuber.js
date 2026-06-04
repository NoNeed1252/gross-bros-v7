import { useEffect, useRef } from 'react';

/**
 * GuardianVTuber Component
 * Connects to the Open-LLM-VTuber FastAPI service on the IONOS VPS.
 * Obfuscated VPS Endpoint: http://[REDACTED_IP]:8000/ws
 */
const GuardianVTuber = ({ isActive }) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isActive) return;

    // Load Live2D dependencies dynamically
    const script = document.createElement('script');
    script.src = "https://cubism.live2d.com/sdk-web/bin/cubismcore.min.js";
    script.async = true;
    script.onload = () => {
      console.log("Guardian OS: Neural Avatar Core Loaded");
      initializeAvatar();
    };
    document.body.appendChild(script);

    const initializeAvatar = () => {
      // Phase 2 implementation: Mount the VTuber Web Interface
      // This connects to the FastAPI WebSocket on the VPS
      const vpsUrl = "http://216.250.127.169:8000"; 
      const iframe = document.createElement('iframe');
      iframe.src = `${vpsUrl}/client-interface`; // Open-LLM-VTuber default client route
      iframe.style.width = "100%";
      iframe.style.height = "500px";
      iframe.style.border = "none";
      iframe.style.borderRadius = "24px";
      iframe.style.background = "transparent";
      
      if (containerRef.current) {
        containerRef.current.appendChild(iframe);
      }
    };

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [isActive]);

  return (
    <div id="vtuber-mount" ref={containerRef} className="panel nft-panel">
      {!isActive && <div className="muted">LOCKED: Gross Bros NFT Required</div>}
    </div>
  );
};

export default GuardianVTuber;
