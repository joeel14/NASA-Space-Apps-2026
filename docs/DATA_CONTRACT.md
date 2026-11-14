# Contrato de datos — Luna entera

**Versión 0.2.1 · 2026-11-14**

Este documento dice **cómo se hace y se entrega cada matriz** para que cada persona
trabaje por su lado y todo encaje al juntarlo. Si algo no está aquí, se añade aquí antes
de programarlo.

- Esquema de `layer.json`: [`docs/schema/layer.schema.json`](schema/layer.schema.json)
- Ejemplo: [`docs/examples/layer.example.json`](examples/layer.example.json)
- Validador: `python tools/validate_layer.py <carpeta_de_la_capa>`

**Cambios en la v0.2.1** (solo añade; nada de la v0.2 cambia):
- **Trabajos:** nuevo T9 · Composición y radiactividad (§7), con 6 capas nuevas.
- **D2** pasa a "propuesta" con la convención que ya usa T6/T9 (−180° y centro de celda).

**Cambios respecto a la v0.1:**
- **Malla:** una sola, la antigua de 10 916 × 5 458 (D1 cerrada).
- **Tiempo:** se trabaja con medias por periodo.
- **Trabajos:** cada capa es un trabajo independiente (§7).
- **Combinación de periodos:** nuevo campo `combine`.
- **Comunicaciones:** la mejor opción entre comunicación directa con la Tierra y satélite de relevo.
- **Capas 0–100:** se permiten como capas derivadas opcionales.

---

## 1. El modelo en una frase

> **Una malla, una capa por magnitud física, medias por periodo, combinación celda a
> celda en la web.**

```
 Trabajo T1 ─┐
 Trabajo T2 ─┤   cada uno entrega:              Integración (web)
 Trabajo T3 ─┼─► layers/<id>/layer.json  ──►  puntuación 0–100 celda a celda
   …         │   layers/<id>/G1K/<periodo>     mapa de calor + puntos calientes
 Trabajo T8 ─┘                                 globo 3D + detalle del polo sur
```

- Todas las capas usan **la misma malla**: la celda (fila, columna) es el mismo trozo
  de Luna en todas.
- Las capas guardan **valores físicos** (fracción 0–1, grados, km, horas…). La
  puntuación 0–100 la calcula la web con los pesos y límites del usuario.
- Nadie necesita el trabajo de otro, salvo donde se indica en §7 (los horizontes).

---

## 2. La malla: `G1K`

| Campo | Valor |
|---|---|
| Tamaño | **10 916 columnas × 5 458 filas** (59,58 M celdas) |
| Paso | Δ = 360° / 10 916 = 180° / 5 458 = **0,032979°** |
| Tamaño de celda | **1,000 km en el ecuador** (circunferencia lunar = 10 916 km); de ancho, 1 km × cos(lat) |
| Columna `c` | centro en `lon = −180 + (c + 0,5)·Δ` (la columna 0 empieza en −180°) |
| Fila `r` | centro en `lat = 90 − (r + 0,5)·Δ` (la fila 0 empieza en +90°, el norte) |
| Orden en el fichero | fila a fila, fila 0 primero, little-endian, sin cabecera |
| Esfera | radio 1 737,4 km |
| Marco | `MOON_ME` (el de LOLA). Latitud planetocéntrica, longitud **este** positiva |

> ⚠️ **Por confirmar:** el origen de la columna 0 (−180°) y que las coordenadas son el
> **centro** de la celda. Si vuestra matriz actual usa otro origen (por ejemplo 0°), se
> cambia aquí **una vez** y lo sigue todo el mundo.

**Cerca de los polos** las celdas se estrechan (120 m de ancho a 83,5°, 17 m a 89°). Es
normal y se acepta. Dos consecuencias:
- Para áreas y medias por zonas, cada celda pesa **cos(lat)**.
- El detalle por fechas del polo sur lo calcula aparte el módulo polar de la web (§8), que
  también entrega sus capas en `G1K`.

**Versión para la web (`W4`)**: 1 440 × 720 (0,25° por celda), misma orientación. La
genera la integración con una media ponderada por área. **Los trabajos solo entregan
`G1K`.**

---

## 3. Formato de una capa

### 3.1 Carpeta

```
layers/
  sun.visible_fraction.mean/
    layer.json                 ← en git
    G1K/2026-2030.f32          ← media de largo plazo
    G1K/2026-01.u8             ← medias mensuales
    G1K/2026-02.u8
    …
  terrain.slope/
    layer.json
    G1K/static.f32
  catalog.json                 ← índice de capas (lo mantiene la integración)
```

- El nombre de fichero es el **id del periodo** (`static` si no depende del tiempo) más
  la extensión del tipo de dato: `.f32` (Float32), `.i16`, `.u16` o `.u8`.
- **Binario crudo**, little-endian, fila a fila. Opcional: una copia GeoTIFF para QGIS.
  El binario es la referencia.

### 3.2 Tipos de dato y tamaños

| Tipo | Bytes por celda | Una matriz G1K | Uso recomendado |
|---|---|---|---|
| Float32 | 4 | 238 MB | Capas fijas y media de largo plazo |
| UInt16 | 2 | 119 MB | Elevación (−32 768 = sin dato) |
| UInt8 | 1 | 60 MB | Medias mensuales (fracciones) |

Fórmula de los enteros: `valor = entero × scale + offset`, con `scale` y `offset` en
`layer.json`. Para fracciones 0–1 en UInt8: `scale = 1/254`, `offset = 0`, `nodata = 255`.

**Sin dato:** NaN en Float32; el valor `nodata` en enteros.

### 3.3 Dónde se suben

- **Git:** solo `layer.json` y `catalog.json`.
- **Binarios** (son grandes): en una *release* de GitHub o en la carpeta compartida del
  equipo, con la misma estructura de carpetas. La huella SHA-256 del `layer.json`
  garantiza que el fichero es el correcto.

### 3.4 `layer.json`

```json
{
  "id": "sun.visible_fraction.mean",
  "version": "0.2.0",
  "title": "Average visible Sun fraction",
  "units": "fraction",
  "validRange": [0, 1],
  "kind": "series",
  "combine": "mean",
  "owner": "Nombre de quien lo hace",
  "fidelity": "computed",
  "method": "Horizonte de T2 + SPICE DE440, MOON_ME, LT+S; observador a 2 m; muestreo horario.",
  "sources": [{ "name": "LOLA LDEM_64", "url": "…", "citation": "Smith et al. (2010)" }],
  "periods": { "2026-01": { "start": "2026-01-01T00:00:00Z", "end": "2026-02-01T00:00:00Z" } },
  "files": [{ "grid": "G1K", "period": "2026-01", "path": "G1K/2026-01.u8", "dtype": "uint8",
              "scale": 0.003937, "offset": 0, "nodata": 255, "sha256": "…" }]
}
```

- `kind`: `static` (no depende del tiempo), `stat` (una estadística de un periodo) o
  `series` (una matriz por periodo).
- `combine`: cómo junta la web varios periodos. `mean` = media ponderada por horas
  (exacta); `max` = máximo (aproximado); `none` = no se combina.
- `fidelity`: `validated` (solo si hay una comparación publicada en `validation`),
  `computed`, `approximate` o `low`.

---

## 4. Tiempo

- Todo en **UTC**, ISO 8601 con `Z`. El final de cada periodo es **exclusivo**.
- Efemérides: **SPICE DE440** (`de440s.bsp`), `moon_pa_de440_200625.bpc`,
  `moon_de440_250416.tf`, aberración **`LT+S`**. Sin refracción.
- Muestreo mínimo: **1 hora**.
- **Periodos estándar** (todos los trabajos usan los mismos):

| Id | Desde | Hasta (exclusivo) | Tipo |
|---|---|---|---|
| `2026-2030` | 2026-01-01 | 2031-01-01 | `stat`, media de largo plazo |
| `2026-01` … `2030-12` | día 1 del mes | día 1 del mes siguiente | `series`, 60 medias mensuales |

- **Cómo usa la web una misión:** coge los meses que toca la misión y los combina según
  `combine`. Por ejemplo, 10 días de marzo y 4 de abril: (10·marzo + 4·abril) / 14.

---

## 5. Definiciones (iguales para todos)

| Término | Definición |
|---|---|
| **Horizonte** | Mayor elevación angular del terreno en cada acimut, vista desde **2 m** sobre el suelo, con la curvatura de la esfera. **72 acimuts** (cada 5°) como mínimo. |
| **Sol visible** | Fracción del disco solar por encima del horizonte (0–1), con el radio angular real del Sol. |
| **Tierra visible** | El centro de la Tierra por encima del horizonte (0 o 1), con paralaje. |
| **Fracción media** | Media temporal de lo anterior en el periodo, muestreo horario. |
| **Noche más larga** | Mayor racha continua con Sol visible < 0,05 en el periodo, en horas. |
| **Contacto DSN** | Tierra visible **y** Luna a ≥ 10° sobre el horizonte de Goldstone, Madrid o Canberra. |
| **Cobertura de relevo** | Al menos un satélite de la constelación de `params` por encima del horizonte local **y** a ≥ `minElevationDeg`. |
| **Sombra permanente** | Celda que nunca recibe Sol directo (LOLA LPSR; fuera de sus productos, 0). |
| **Pendiente** | Grados respecto a la horizontal, con la base de cálculo en `params.baselineM`. |

---

## 6. Capas derivadas 0–100 (opcionales)

Si a alguien le resulta útil trabajar con una nota de 0 a 100 por factor, puede entregarla
**además** de la capa física, nunca en su lugar:

- id: `suitability.<factor>` (por ejemplo `suitability.slope`), UInt8, 0–100.
- En `layer.json`, `params.derivedFrom` (id de la capa física) y `params.function` (la
  fórmula exacta, por ejemplo `"100 * max(0, 1 - slope_deg / 15)"`).
- La web puede usarlas para una vista rápida, pero la puntuación oficial se calcula desde
  la capa física, porque los límites los elige el usuario.

---

## 7. Trabajos (cada uno se puede hacer por separado)

Prioridad: **P0** imprescindible · **P1** muy recomendable · **P2** si da tiempo.

### T1 · Terreno — P0
- **Entrega:** `terrain.elevation` (m, static, UInt16 con `scale` 0,5 u Float32) y
  `terrain.slope` (°, static, Float32).
- **Datos:** LOLA **LDEM_64** global (NASA PDS, `lola_gdr/cylindrical/`).
- **Cómo:** remuestrear LDEM_64 a G1K (media por área); pendiente a partir de la elevación
  con base de ~1 km (`params.baselineM`).
- **Prueba:** Shackleton (89,67°S 129,78°E) < −2 000 m; Mons Mouton (85,43°S 31,83°E)
  > +5 000 m.
- **Depende de:** nada.

### T2 · Horizontes — P0 (producto intermedio, no se publica en la web)
- **Entrega:** horizonte de cada celda, 72 acimuts, UInt8 con 0,1° por paso
  (`grados = q·0,1 − 5`). Unos 4,3 GB: se comparte solo con T3, T4 y T5.
- **Datos:** LOLA LDEM_64 (o la salida de T1).
- **Cómo:** trazar rayos sobre el relieve con la curvatura incluida. El método está en
  `pipeline/moonsite/horizon.py`, que se puede reutilizar.
- **Depende de:** nada (o T1).

### T3 · Luz — P0
- **Entrega:** `sun.visible_fraction.mean` (`series` mensual UInt8 + `stat` 2026–2030
  Float32, `combine: mean`) y `sun.longest_night_h.max` (`series`, `combine: max`).
- **Datos:** T2 + SPICE (Sol cada hora).
- **Validación:** comparar con LOLA AVGVISIB en 65–90° de latitud y anotar la diferencia
  en `validation`.
- **Prueba:** 0°N 0°E entre 0,40 y 0,55 en el periodo largo.
- **Depende de:** T2.

### T4 · Tierra y DSN — P0 / P1
- **Entrega:** `earth.visible_fraction.mean` (P0) y `earth.dsn_fraction.mean` (P1), ambas
  `series` + `stat`, `combine: mean`.
- **Datos:** T2 + SPICE (Tierra cada hora) + estaciones DSN (documento DSN 810-005).
- **Prueba:** 0°N 0°E > 0,95; 0°N 180°E < 0,05.
- **Depende de:** T2.

### T5 · Satélites de relevo — P1
- **Entrega:** `relay.coverage_fraction.mean` (`series` + `stat`, `combine: mean`) y
  `relay.max_gap_h` (`series`, `combine: max`).
- **Datos:** órbitas de la constelación elegida (elementos orbitales y fecha en `params`,
  con la fuente citada) + T2 para el horizonte. Si se hace sin T2 (horizonte liso), marcar
  `fidelity: approximate`.
- **Depende de:** T2 (recomendado).

### T6 · Sombra permanente y hielo — P0 / P1
- **Entrega:** `sun.psr_mask` (fracción, static, P0), `ice.psr_distance_km` (km, static,
  P0), `ice.hydrogen_ppm` (static, P2).
- **Datos:** LOLA **LPSR** (productos de 65°S y 65°N, NASA PDS; fuera de ellos, 0) y
  Lunar Prospector Neutron Spectrometer (NASA PDS) para el hidrógeno.
- **Depende de:** nada.

### T7 · Temperatura y rocas — P2
- **Entrega:** `thermal.max_temp_k`, `thermal.min_temp_k`, `terrain.rock_abundance`.
- **Datos:** LRO **Diviner** (NASA PDS; rocas: Bandfield et al. 2011).
- **Depende de:** nada.

### T8 · Ciencia — P1
- **Entrega:** `science.region_mask` (id de región, static, UInt8) + una tabla
  `science_regions.json` con el nombre, el motivo y la fuente de cada región.
- **Datos:** regiones Artemis III (NASA, 2024), cuenca Aitken (SPA), sitios de alunizaje
  (LROC, Wagner et al. 2017)…
- **Depende de:** nada.

### T9 · Composición y radiactividad — P2 (Joel)
- **Entrega** (todas `static`, `UInt16` con `scale`, `nodata` 65 535):
  `regolith.feo_wt_pct` (% en peso), `regolith.tio2_wt_pct` (% en peso),
  `radiation.thorium_ppm`, `radiation.potassium_ppm`, `radiation.uranium_ppm` (ppm) y
  `radiation.natural_gamma_dose` (nGy/h). También hace `ice.hydrogen_ppm` de T6.
- **Datos:** Lunar Prospector Gamma-Ray y Neutron Spectrometer, productos especiales de
  NASA PDS Geosciences (0,5°): `ironhd`, `titanium2d`, `thoriumhd`, `potassium2d`,
  `uranium5d`, `hydrogenhd`. Dosis = 13,078·K(%) + 5,675·U + 2,494·Th (UNSCEAR 2000).
- **Fidelidad:** `approximate`; la huella real del dato es de ~60–150 km, el paso a `G1K`
  es bilineal y solo suaviza.
- **Uso en la puntuación** (propuesta): recursos = FeO + TiO2 + H (más es mejor);
  radiación natural = dosis (menos es mejor). Si se quieren 0–100, como derivadas §6.
- **Depende de:** nada. Código: `pipeline/moonsite/prospector.py`.

### Integración — este repositorio
- `W4` para la web, puntuación, mapa de calor, puntos calientes, globo 3D, módulo polar y
  `catalog.json`.
- **Comunicaciones en la puntuación** = la mejor opción entre `earth.visible_fraction`
  (directo) y `relay.coverage_fraction` (relevo). La cara oculta **no se quita**: sin
  relevo, su comunicación directa es 0, y es correcto. Un interruptor "Require
  direct-to-Earth contact" permite descartar esas zonas cuando la misión no tenga relevo.

---

## 8. Módulo polar (interno de la web)

Para el **detalle por fechas** del polo sur (mejor hora de aterrizaje, cuenta atrás hasta
la puesta de Sol, vista 3D en una fecha), la web usa una malla interna estereográfica de
400 × 400 km a 1 km, con horizontes y efemérides horarias. **No forma parte de ningún
trabajo**: ya está hecha y validada contra JPL Horizons. Sus capas se entregan también
convertidas a `G1K` para que solo exista una malla hacia fuera.

---

## 9. Pruebas de aceptación (las hace el validador)

1. **Campos:** los obligatorios de `layer.json` y el id con formato `<dominio>.<magnitud>[.<estadística>]`.
2. **Tamaño:** filas × columnas × bandas × bytes del tipo (G1K: 10 916 × 5 458).
3. **Huella:** SHA-256 = `files[].sha256`.
4. **Rango:** todos los valores (salvo los que no tienen dato) dentro de `validRange`.
5. **Orientación** con puntos conocidos (un mapa girado o reflejado falla aquí):

| Capa | Punto | Esperado |
|---|---|---|
| `terrain.elevation` | Shackleton, 89,67°S 129,78°E | < −2 000 m |
| `terrain.elevation` | Mons Mouton, 85,43°S 31,83°E | > +5 000 m |
| `earth.visible_fraction.mean` | 0°N 0°E (cara visible) | > 0,95 |
| `earth.visible_fraction.mean` | 0°N 180°E (cara oculta) | < 0,05 |
| `sun.visible_fraction.mean` (periodo ≥ 1 año) | 0°N 0°E | 0,40 – 0,55 |

---

## 10. Decisiones

| # | Decisión | Estado |
|---|---|---|
| D1 | Malla global | **Cerrada:** 10 916 × 5 458 (`G1K`) |
| D2 | Origen de la columna 0 y centro de celda | **Propuesta:** −180° y centro (la usan T6/T9) |
| D3 | Periodos | **Cerrada:** mensuales 2026–2030 + media 2026–2030 |
| D4 | Constelación de relevo | **Pendiente** (T5) |
| D5 | Una sola malla hacia fuera | **Cerrada:** solo `G1K`; el módulo polar es interno |
| D6 | Cara oculta | **Cerrada:** se mantiene; comunicación = mejor opción entre directo y relevo |

Cambios a este contrato: por pull request, subiendo la versión y anotando qué cambia.
