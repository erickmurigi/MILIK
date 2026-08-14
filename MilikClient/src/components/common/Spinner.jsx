// Two-ring Milik spinner — matches the PageLoader in App.jsx
const SIZE_PX = { sm: 16, md: 26, lg: 40 };

const Spinner = ({ size = "md", className = "" }) => {
  const px     = SIZE_PX[size] ?? SIZE_PX.md;
  const bw     = Math.max(2, Math.round(px * 0.075));   // outer border width
  const ibw    = Math.max(1, Math.round(px * 0.05));    // inner border width
  const inset  = Math.round(px * 0.225);                // inner ring inset

  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`}>
      <span className="relative shrink-0" style={{ width: px, height: px }}>
        <span
          className="absolute inset-0 animate-spin"
          style={{
            border: `${bw}px solid #e2e8f0`,
            borderTopColor:   "#027333",
            borderRightColor: "#0B3B2E",
            animationDuration: "0.9s",
          }}
        />
        <span
          className="absolute animate-spin"
          style={{
            inset,
            border: `${ibw}px solid #e2e8f0`,
            borderBottomColor: "#027333",
            borderLeftColor:   "#0B3B2E",
            animationDuration:      "0.6s",
            animationDirection:     "reverse",
          }}
        />
      </span>
    </span>
  );
};

export default Spinner;
