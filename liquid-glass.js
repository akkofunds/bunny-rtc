/* Liquid Glass Filter Definitions */
.liquid-glass {
  position: relative;
  isolation: isolate;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(28px) saturate(170%);
  -webkit-backdrop-filter: blur(28px) saturate(170%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.4),
    inset 0 1px 1px rgba(255, 255, 255, 0.28),
    inset 0 -1px 1px rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

/* The refraction layer */
.liquid-glass::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  background: inherit;
  filter: url(#liquid-refraction);
  opacity: 0.55;
  pointer-events: none;
  z-index: -1;
  mix-blend-mode: soft-light;
}

/* Specular highlight sheen */
.liquid-glass::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.18) 0%,
    transparent 40%,
    transparent 60%,
    rgba(255, 255, 255, 0.06) 100%
  );
  pointer-events: none;
  mix-blend-mode: overlay;
}
