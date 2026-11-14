# Impacto del alunizaje · regolito y eyecta

Simulador 3D de la nube de eyecta que levanta el chorro del motor al alunizar, sobre relieve
real de LOLA. Parte de Joel para el *Lunar Landing Site Navigator*.

- **`index.html`** — simulador autocontenido (ábrelo en el navegador; carga Three.js desde CDN).
  Incluye el relieve LOLA 5 m/píxel del Site01 (connecting ridge, Barker et al. 2021, NASA PGDA
  producto 78) recortado a 9 × 9 km.
- **`eyecta.py`** — el mismo modelo balístico en Python (gráficos y JSON).
- **`dem_a_json.py`** — convierte cualquier GeoTIFF de LOLA (estereográfica polar, metros) al
  `.json` que carga el simulador (botón «Cargar otro sitio»).

## Qué calcula

- Masa de regolito expulsada, reparto por tamaño de grano (log-normal, d₅₀ 40–130 µm, Carrier 1973).
- Trayectorias balísticas sobre la Luna esférica; choque con el relieve en los primeros 4,5 km.
- Dónde se deposita cada tamaño, cuánto frena el relieve, cuánto sale a órbita o escapa.
- Datos del punto de aterrizaje: coordenadas, altitud LOLA, pendiente, desnivel en 1 km.
- Vista del piloto con la ventana del módulo y la pérdida de visibilidad por el polvo.

## Datos y calibración

| Parámetro | Valor | Fuente |
|---|---|---|
| Masa erosionada (Apollo 12) | 2,6 t | Lane y Metzger (2015) |
| Masa erosionada (Apollo, revisión) | 11–26 t | Metzger (2024) |
| Ángulo de eyección | cono plano de ~1–3° | Immer et al. (2008, 2011); Metzger (2024) |
| Velocidad de impacto en la Surveyor III | 300–2000 m/s | Immer et al. (2011) |
| Picaduras en la Surveyor III | 103 /cm² | Immer et al. (2011) |
| Visibilidad nula en los últimos ~12 m | Apollo 12 | informe de la misión |

Modelo de primer orden: no simula la erosión durante el descenso. Los escenarios
«lander pequeño» y «~100 t» son supuestos y están marcados así en la interfaz.
