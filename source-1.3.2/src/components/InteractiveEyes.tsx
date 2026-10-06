import React, { useEffect, useRef, useState } from 'react';

export const InteractiveEyes: React.FC = () => {
  const leftEyeRef = useRef<HTMLDivElement>(null);
  const rightEyeRef = useRef<HTMLDivElement>(null);

  const [leftPupilPos, setLeftPupilPos] = useState({ x: 0, y: 0 });
  const [rightPupilPos, setRightPupilPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      } else {
        return;
      }

      // Calculate position for left eye
      if (leftEyeRef.current) {
        const rect = leftEyeRef.current.getBoundingClientRect();
        const eyeCenterX = rect.left + rect.width / 2;
        const eyeCenterY = rect.top + rect.height / 2;

        const dx = clientX - eyeCenterX;
        const dy = clientY - eyeCenterY;
        const angle = Math.atan2(dy, dx);
        const distance = Math.min(Math.hypot(dx, dy) / 10, 11); // max radius offset 11px

        setLeftPupilPos({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
        });
      }

      // Calculate position for right eye
      if (rightEyeRef.current) {
        const rect = rightEyeRef.current.getBoundingClientRect();
        const eyeCenterX = rect.left + rect.width / 2;
        const eyeCenterY = rect.top + rect.height / 2;

        const dx = clientX - eyeCenterX;
        const dy = clientY - eyeCenterY;
        const angle = Math.atan2(dy, dx);
        const distance = Math.min(Math.hypot(dx, dy) / 10, 11); // max radius offset 11px

        setRightPupilPos({
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
        });
      }
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
    };
  }, []);

  return (
    <div className="flex items-center justify-center gap-2.5 my-3 select-none" aria-label="Interactive eyes tracking cursor">
      {/* Left Eyeball */}
      <div
        ref={leftEyeRef}
        className="w-13 h-13 sm:w-15 sm:h-15 rounded-full bg-white border-2 border-slate-700/80 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.5)] flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105"
      >
        {/* Subtle sclera gradient / shadow */}
        <div className="absolute inset-0 bg-radial from-transparent via-transparent to-slate-200/50 pointer-events-none" />

        {/* Pupil & Iris */}
        <div
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#0b101d] flex items-center justify-center relative shadow-md transition-transform ease-out duration-75"
          style={{
            transform: `translate(${leftPupilPos.x}px, ${leftPupilPos.y}px)`,
          }}
        >
          {/* Blue iris ring */}
          <div className="w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full bg-[#172554] border border-blue-500/70 flex items-center justify-center">
            {/* Deep black inner pupil */}
            <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-black flex items-center justify-center">
              {/* Light glint reflection */}
              <div className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1 shadow-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* Right Eyeball */}
      <div
        ref={rightEyeRef}
        className="w-13 h-13 sm:w-15 sm:h-15 rounded-full bg-white border-2 border-slate-700/80 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4),0_4px_12px_rgba(0,0,0,0.5)] flex items-center justify-center relative overflow-hidden transition-transform hover:scale-105"
      >
        {/* Subtle sclera gradient / shadow */}
        <div className="absolute inset-0 bg-radial from-transparent via-transparent to-slate-200/50 pointer-events-none" />

        {/* Pupil & Iris */}
        <div
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#0b101d] flex items-center justify-center relative shadow-md transition-transform ease-out duration-75"
          style={{
            transform: `translate(${rightPupilPos.x}px, ${rightPupilPos.y}px)`,
          }}
        >
          {/* Blue iris ring */}
          <div className="w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full bg-[#172554] border border-blue-500/70 flex items-center justify-center">
            {/* Deep black inner pupil */}
            <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-black flex items-center justify-center">
              {/* Light glint reflection */}
              <div className="w-1.5 h-1.5 rounded-full bg-white absolute top-1 right-1 shadow-sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
