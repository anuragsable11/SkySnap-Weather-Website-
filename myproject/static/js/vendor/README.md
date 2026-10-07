# Vendored libraries

## three.min.js

[Three.js](https://threejs.org/) **r186** (npm `three@0.186.1`), MIT licence (see `three.LICENSE`).

It holds only the parts of Three.js that the weather scene in `static/js/weather` imports: 520 KB minified, 133 KB gzipped, against about 2.1 MB for the full build. Vendoring it means no CDN and no build step: Django serves it as a plain static file, and `boot.js` loads it only on devices that will draw the scene.

The modules import it by relative path (`../vendor/three.min.js`). If you import a Three.js name that isn't listed below, the browser reports that the module "does not provide an export named …". Add the name to the list and rebuild:

```bash
mkdir three-build && cd three-build
npm init -y
npm install three@0.186.1 esbuild@0.25.10
cat > entry.js <<'EOF'
export {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DataTexture, Float32BufferAttribute,
  InstancedBufferAttribute, InstancedBufferGeometry, LinearFilter, Mesh, NormalBlending, OneFactor,
  PerspectiveCamera, PlaneGeometry, Points, RedFormat, RepeatWrapping, Scene, ShaderMaterial,
  SrcAlphaFactor, Vector2, Vector3, Vector4, WebGLRenderer, ZeroFactor,
} from 'three';
EOF
npx esbuild entry.js --bundle --minify --format=esm --target=es2020 --legal-comments=inline --outfile=three.min.js
```

Then copy `three.min.js` here. Node is needed only for this step, not to run the site.
