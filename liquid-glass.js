// Inject the SVG filter once
(function injectLiquidFilter() {
  if (document.getElementById('liquid-glass-svg')) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'liquid-glass-svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';

  svg.innerHTML = `
    <defs>
      <filter id="liquid-refraction" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="3" seed="5" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G"/>
        <feGaussianBlur stdDeviation="0.6"/>
      </filter>
    </defs>
  `;

  document.body.prepend(svg);
})();
