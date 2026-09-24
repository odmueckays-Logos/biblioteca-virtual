// Render con postprocesado: oclusión ambiental (GTAO), profundidad de campo,
// resplandor suave, mapeo de tonos y un acabado con viñeta y grano.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Oculta objetos translúcidos (haz de luz, polvo) mientras se calculan AO y profundidad.
class VisibilityPass extends Pass {
  constructor(objects, visible) {
    super();
    this.objects = objects;
    this.visible = visible;
    this.needsSwap = false;
  }
  render() {
    for (const o of this.objects) o.visible = this.visible && o.userData.wantsVisible !== false;
  }
}

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.022 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      d.x *= uResolution.x / uResolution.y;
      float r = length(d);
      color.rgb *= 1.0 - uVignette * smoothstep(0.32, 1.05, r);
      // Leve tono cálido en las sombras.
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb += vec3(0.012, 0.006, -0.004) * (1.0 - smoothstep(0.0, 0.45, luma));
      float n = hash(floor(vUv * uResolution) + fract(uTime * 7.3) * 97.0) - 0.5;
      color.rgb += n * uGrain * (1.0 - luma * 0.6);
      gl_FragColor = color;
    }
  `,
};

// Ajustes de imagen, uno por cosa que se puede apagar.
//
//   resolucion  cuántos píxeles se dibujan por píxel de pantalla. Menos de 1 es
//               dibujar más pequeño y estirar: lo que más alivia a una tarjeta
//               justa. Nunca pasa de la densidad real de la pantalla.
//   suavizado   cómo se disimulan los bordes de sierra: 'msaa4' y 'msaa2' son de
//               la tarjeta (los mejores y los más caros) y 'fxaa' es un filtro
//               barato que empaña un poco.
//   gtao        oclusión ambiental: la sombra suave de los rincones.
//   bokeh       profundidad de campo: lo que está lejos se desenfoca.
//   bloom       el resplandor de la luz de la ventana.
//   sombras     lado del mapa de sombras del sol (0 = sin sombras).
//   cuadros     tope de cuadros por segundo (0 = los que dé la pantalla).
// Medido en una AMD RX 6550M a 1536×794 con la pantalla al 1,25: alta 93 cuadros
// por segundo, media 144 (el tope de la pantalla). Lo que más cuesta, por orden:
// el suavizado de la tarjeta (unos 45), la nitidez por encima de 1 (unos 50 al
// pasar de 1 a 1,25) y la sombra de rincón (unos 25). Por eso «media» no apaga
// ningún efecto: solo dibuja menos píxeles y suaviza los bordes por lo barato.
export const CALIDADES = {
  alta: { resolucion: 1.5, suavizado: 'msaa4', gtao: true, bokeh: true, bloom: true, sombras: 2048, cuadros: 0 },
  media: { resolucion: 1, suavizado: 'fxaa', gtao: true, bokeh: true, bloom: true, sombras: 2048, cuadros: 0 },
  baja: { resolucion: 0.85, suavizado: 'fxaa', gtao: false, bokeh: false, bloom: true, sombras: 1024, cuadros: 60 },
  minima: { resolucion: 0.7, suavizado: 'ninguno', gtao: false, bokeh: false, bloom: false, sombras: 0, cuadros: 30 },
};

const MUESTRAS = { msaa4: 4, msaa2: 2, fxaa: 0, ninguno: 0 };

// A cuánto se calcula la sombra de rincón respecto de la pantalla.
const MEDIA = 0.5;

// Qué calidad se parece más a estos ajustes (para el panel de opciones).
export function nombreCalidad(ajustes) {
  const iguales = (a, b) => Object.keys(b).every((k) => a[k] === b[k]);
  return Object.keys(CALIDADES).find((n) => iguales(ajustes, CALIDADES[n])) || 'personalizada';
}

export function createRenderer(canvas, scene, camera, ajustes = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  renderer.setSize(size.x, size.y, false);

  let settings = { ...CALIDADES.alta, ...ajustes };
  const translucent = [];

  let composer;
  let gtaoPass;
  let bokehPass;
  let bloomPass;
  let fxaaPass;
  let finishPass;

  function build() {
    const pr = Math.min(window.devicePixelRatio || 1, settings.resolucion);
    renderer.setPixelRatio(pr);

    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: MUESTRAS[settings.suavizado] || 0,
    });
    composer?.dispose();
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(size.x, size.y);

    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new VisibilityPass(translucent, false));

    // La sombra de rincón es una mancha suave: se calcula a media resolución y se
    // estira. Cuesta la cuarta parte y no se nota la diferencia.
    // (El composer les pasa el tamaño completo al cambiar de tamaño la ventana;
    // por eso se le cambia el método, para que siempre se queden a la mitad.)
    gtaoPass = new GTAOPass(scene, camera, size.x * MEDIA, size.y * MEDIA);
    const gtaoSetSize = gtaoPass.setSize.bind(gtaoPass);
    gtaoPass.setSize = (w, h) => gtaoSetSize(Math.max(2, Math.round(w * MEDIA)), Math.max(2, Math.round(h * MEDIA)));
    gtaoPass.blendIntensity = 0.85;
    gtaoPass.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
    gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtaoPass.enabled = settings.gtao;
    composer.addPass(gtaoPass);

    const prevBokeh = bokehPass?.uniforms;
    bokehPass = new BokehPass(scene, camera, {
      focus: prevBokeh ? prevBokeh.focus.value : 2.2,
      aperture: prevBokeh ? prevBokeh.aperture.value : 0.0006,
      maxblur: prevBokeh ? prevBokeh.maxblur.value : 0.004,
    });
    bokehPass.enabled = settings.bokeh;
    composer.addPass(bokehPass);

    composer.addPass(new VisibilityPass(translucent, true));

    // El resplandor va a resolución completa a propósito: calculado pequeño, su
    // halo se ensancha al estirarlo y emborrona lo que rodea —los carteles de los
    // estantes se volvían ilegibles—. Lo que ahorraba no valía eso.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.16, 0.55, 1.5);
    bloomPass.enabled = settings.bloom;
    composer.addPass(bloomPass);

    composer.addPass(new OutputPass());

    // Suavizado barato, para cuando la tarjeta no puede con el de verdad.
    fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.enabled = settings.suavizado === 'fxaa';
    fxaaPass.material.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr));
    composer.addPass(fxaaPass);

    finishPass = new ShaderPass(FinishShader);
    finishPass.uniforms.uResolution.value.set(size.x * pr, size.y * pr);
    composer.addPass(finishPass);
  }

  // Las sombras: el tamaño del mapa de cada luz sale del que le puso la escena,
  // reducido a escala. Así no hace falta que el render conozca las luces.
  function aplicarSombras() {
    const hay = settings.sombras > 0;
    if (renderer.shadowMap.enabled !== hay) {
      renderer.shadowMap.enabled = hay;
      scene.traverse((o) => {
        for (const m of o.material ? [].concat(o.material) : []) m.needsUpdate = true;
      });
    }
    if (!hay) return;
    scene.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      o.userData.sombraBase ??= o.shadow.mapSize.x;
      const lado = Math.max(256, Math.round(o.userData.sombraBase * (settings.sombras / 2048)));
      if (o.shadow.mapSize.x === lado) return;
      o.shadow.mapSize.setScalar(lado);
      o.shadow.map?.dispose();
      o.shadow.map = null;
    });
    renderer.shadowMap.needsUpdate = true;
  }

  build();
  aplicarSombras();

  function resize() {
    size.set(window.innerWidth, window.innerHeight);
    camera.aspect = size.x / size.y;
    camera.updateProjectionMatrix();
    renderer.setSize(size.x, size.y, false);
    composer.setSize(size.x, size.y);
    const pr = renderer.getPixelRatio();
    finishPass.uniforms.uResolution.value.set(size.x * pr, size.y * pr);
    fxaaPass.material.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr));
  }
  window.addEventListener('resize', resize);

  // Enfoque (profundidad de campo) en metros.
  const dof = { focus: 2.2, aperture: 0.0006, maxblur: 0.004 };

  return {
    renderer,
    get composer() {
      return composer;
    },
    dof,
    addTranslucent(object) {
      translucent.push(object);
    },
    removeTranslucent(object) {
      const i = translucent.indexOf(object);
      if (i >= 0) translucent.splice(i, 1);
    },
    // Cambia los ajustes que se le pasen y deja los demás como estaban. Encender
    // o apagar un efecto es inmediato; cambiar la resolución o el suavizado obliga
    // a rehacer las pasadas.
    aplicar(parcial = {}) {
      const antes = settings;
      settings = { ...settings, ...parcial };
      if (settings.resolucion !== antes.resolucion || settings.suavizado !== antes.suavizado) build();
      else {
        gtaoPass.enabled = settings.gtao;
        bloomPass.enabled = settings.bloom;
        fxaaPass.enabled = settings.suavizado === 'fxaa';
      }
      if (settings.sombras !== antes.sombras) aplicarSombras();
      return settings;
    },
    // Las luces nuevas (al rehacer la sala) también tienen que hacer caso.
    revisarSombras: aplicarSombras,
    get ajustes() {
      return { ...settings };
    },
    render(time) {
      bokehPass.uniforms.focus.value = dof.focus;
      bokehPass.uniforms.aperture.value = dof.aperture;
      bokehPass.uniforms.maxblur.value = dof.maxblur;
      bokehPass.enabled = settings.bokeh && dof.aperture > 0.00001;
      finishPass.uniforms.uTime.value = time;
      composer.render();
    },
    setVignette(v) {
      finishPass.uniforms.uVignette.value = v;
    },
  };
}
