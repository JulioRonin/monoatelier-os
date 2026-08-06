/**
 * FORGE 3D — construye la escena three.js desde project.json (la fuente de
 * verdad generada por mono-forge) y exporta GLB/USDZ para el visor AR.
 *
 * Regla de oro del motor: aquí NUNCA se calculan medidas ni posiciones.
 * La colocación viene derivada en el JSON (mono_forge/rules/posicion.py):
 * cada panel trae `colocacion: [{x,y,z,sx,sy,sz}]` en mm (centro + extensión).
 *
 * Mapeo de ejes mono-forge → three.js (Y-up):
 *   forge X (a lo largo del muro) → three X
 *   forge Z (altura)              → three Y
 *   forge Y (profundidad al muro) → three -Z  (el frente mira a la cámara)
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

// --- Tipos del project.json (espejo de mono_forge/models.py) ---

export interface ForgeColocacion {
    x: number; y: number; z: number;
    sx: number; sy: number; sz: number;
}

export interface ForgePanel {
    name: string;
    largo: number;
    ancho: number;
    espesor: number;
    cantidad: number;
    material: string;
    rol_estructural: string;
    justificacion: string;
    veta: string;
    colocacion?: ForgeColocacion[];
}

export interface ForgeModule {
    id: string;
    tipo: string;
    ancho: number;
    alto: number;
    prof: number;
    panels: ForgePanel[];
    notas: string[];
}

export interface ForgeTramo {
    id: string;
    muro: string;
    modulos: string[];
    panels: ForgePanel[];
    notas: string[];
}

export interface ForgeProjectData {
    cliente: string;
    nombre: string;
    moneda: string;
    modules: ForgeModule[];
    tramos: ForgeTramo[];
    notas: string[];
}

// --- Paleta de materiales (espejo de blender/materials.py) ---

const PALETA: Record<string, { color: number; roughness: number; metalness?: number }> = {
    'MEL-BLA-15-IMP': { color: 0xebebe6, roughness: 0.55 },
    'MEL-BLA-15-DUR': { color: 0xebebe6, roughness: 0.55 },
    'MEL-BLA-15-ARA': { color: 0xebebe6, roughness: 0.55 },
    'BRI-BLA-19-ARA': { color: 0xf2f2f2, roughness: 0.08 },
    'MDF-003-FON': { color: 0xbfae8c, roughness: 0.80 },
    'MEL-BLA-19-CUB': { color: 0xf0f0eb, roughness: 0.35 },
    'NEGRO-MATE': { color: 0x0d0d0d, roughness: 0.70 },
    'ROBLE-CLARO': { color: 0xb89466, roughness: 0.45 },
    'MEL-ROBLE-NAT-15': { color: 0xbf996b, roughness: 0.42 },
    'LAC-VERDE-SAGE-15': { color: 0xa6b394, roughness: 0.30 },
};

const MM = 0.001; // el GLB/USDZ va en METROS: escala real para AR

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function materialDe(sku: string): THREE.MeshStandardMaterial {
    let mat = materialCache.get(sku);
    if (!mat) {
        const cfg = PALETA[sku] || PALETA['MEL-BLA-15-IMP'];
        mat = new THREE.MeshStandardMaterial({
            color: cfg.color,
            roughness: cfg.roughness,
            metalness: cfg.metalness ?? 0,
        });
        materialCache.set(sku, mat);
    }
    return mat;
}

/** ¿El JSON trae colocación 3D derivada? */
export function tieneColocacion(data: ForgeProjectData): boolean {
    return [...data.modules, ...(data.tramos || [])].some(c =>
        (c.panels || []).some(p => (p.colocacion || []).length > 0));
}

/**
 * Construye el grupo three.js del proyecto, a escala real (metros),
 * centrado en X/Z y con el piso en y=0 (así AR lo asienta en el suelo).
 */
export function construirProyecto(data: ForgeProjectData): THREE.Group {
    const group = new THREE.Group();
    group.name = data.nombre || 'mono-forge';

    const contenedores = [...(data.modules || []), ...(data.tramos || [])];
    for (const cont of contenedores) {
        for (const p of cont.panels || []) {
            const colocaciones = p.colocacion || [];
            colocaciones.forEach((c, i) => {
                const geo = new THREE.BoxGeometry(c.sx * MM, c.sz * MM, c.sy * MM);
                const mesh = new THREE.Mesh(geo, materialDe(p.material));
                mesh.name = colocaciones.length > 1 ? `${p.name}_${i + 1}` : p.name;
                mesh.position.set(c.x * MM, c.z * MM, -c.y * MM);
                mesh.userData = { rol: p.rol_estructural, material: p.material, modulo: cont.id };
                group.add(mesh);
            });
        }
    }

    // centrar en X/Z dejando el piso en y=0
    const box = new THREE.Box3().setFromObject(group);
    if (!box.isEmpty()) {
        const centro = box.getCenter(new THREE.Vector3());
        group.children.forEach(ch => {
            ch.position.x -= centro.x;
            ch.position.z -= centro.z;
            ch.position.y -= box.min.y;
        });
    }
    return group;
}

/** GLB binario (Android Scene Viewer / WebXR / visor web). */
export async function exportarGLB(group: THREE.Object3D): Promise<Blob> {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(group, { binary: true });
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

/** USDZ (iOS Quick Look). */
export async function exportarUSDZ(group: THREE.Object3D): Promise<Blob> {
    const exporter = new USDZExporter();
    const data = await exporter.parseAsync(group as THREE.Scene);
    return new Blob([data as BlobPart], { type: 'model/vnd.usdz+zip' });
}

/** Resumen rápido para las tarjetas del listado. */
export function resumenProyecto(data: ForgeProjectData) {
    let paneles = 0;
    let areaM2 = 0;
    for (const cont of [...(data.modules || []), ...(data.tramos || [])]) {
        for (const p of cont.panels || []) {
            paneles += p.cantidad || 1;
            areaM2 += (p.largo / 1000) * (p.ancho / 1000) * (p.cantidad || 1);
        }
    }
    const anchoTotal = (data.modules || [])
        .filter(m => m.tipo !== 'superior')
        .reduce((s, m) => s + m.ancho, 0);
    return {
        modulos: (data.modules || []).length,
        paneles,
        areaM2: Math.round(areaM2 * 100) / 100,
        anchoTotalMm: anchoTotal,
    };
}
