// Two-ring Milik spinner — matches the PageLoader in App.jsx
// [px, outerBorderWidth, innerBorderWidth, innerRingInset]
const SIZES = {
  sm: [16, 2, 1, 4],
  md: [26, 2, 1, 6],
  lg: [40, 3, 2, 9],
};

const Spinner = ({ size = "md", className = "" }) => {
  const [px, bw, ibw, inset] = SIZES[size] ?? SIZES.md;

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
