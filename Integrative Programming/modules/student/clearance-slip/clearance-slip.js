/* Placeholder QR: draws a pattern from the slip code. Replace with the real QR once the API returns the signed token. */
(function () {
  const code = document.getElementById("slip-code").textContent;
  const size = 21;
  let seed = 0;
  for (const ch of code) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const box = document.getElementById("qr");
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = Math.floor(i / size), c = i % size;
    const finder = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
    const on = finder ? (r % 6 === 0 || c % 6 === 0 || (r % 6 > 1 && r % 6 < 5 && c % 6 > 1 && c % 6 < 5)) || ((r > 13) && (r % 6 === 0 || c % 6 === 0)) : seed % 2 === 0;
    const cell = document.createElement("i");
    if (on) cell.className = "on";
    box.appendChild(cell);
  }
})();
