(function () {
  if (document.getElementById('liquid-glass-svg')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'liquid-glass-svg';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;pointer-events:none;';
  svg.innerHTML = `
    <defs>
      <filter id="liquid-refraction" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.01 0.015" numOctaves="2" seed="3" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  `;
  document.body.prepend(svg);
})();
