/**
 * Visor 3D del módulo Forge. Renderiza el grupo three.js construido desde
 * project.json (lib/forge3d.ts). Órbita + zoom con el mouse / touch.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ForgeProjectData, construirProyecto } from '../lib/forge3d';

interface ForgeViewerProps {
    data: ForgeProjectData;
    darkMode?: boolean;
    className?: string;
}

const ForgeViewer: React.FC<ForgeViewerProps> = ({ data, darkMode = false, className }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<{ scene: THREE.Scene; group?: THREE.Group } | null>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        const scene = new THREE.Scene();
        sceneRef.current = { scene };

        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        // luz estilo estudio: una key suave + ambiente + piso que recibe sombra
        const ambient = new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 0.9);
        scene.add(ambient);
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(2.5, 4, 3);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        scene.add(key);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI / 2 + 0.05;

        const resize = () => {
            const w = mount.clientWidth, h = mount.clientHeight;
            if (!w || !h) return;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        const ro = new ResizeObserver(resize);
        ro.observe(mount);
        resize();

        let raf = 0;
        const animate = () => {
            raf = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // contenido
        const group = construirProyecto(data);
        group.traverse(o => {
            if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        scene.add(group);
        sceneRef.current.group = group;

        const box = new THREE.Box3().setFromObject(group);
        const size = box.getSize(new THREE.Vector3());
        const radio = Math.max(size.x, size.y, size.z, 0.5);

        // piso sutil
        const piso = new THREE.Mesh(
            new THREE.CircleGeometry(radio * 1.6, 48),
            new THREE.MeshStandardMaterial({ color: darkMode ? 0x111827 : 0xe7e2d9, roughness: 1 })
        );
        piso.rotation.x = -Math.PI / 2;
        piso.receiveShadow = true;
        scene.add(piso);

        camera.position.set(radio * 1.1, size.y * 0.9 + 0.3, radio * 1.5);
        controls.target.set(0, size.y / 2, 0);
        controls.update();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            controls.dispose();
            renderer.dispose();
            scene.traverse(o => {
                const m = o as THREE.Mesh;
                if (m.isMesh) m.geometry?.dispose();
            });
            mount.removeChild(renderer.domElement);
        };
    }, [data, darkMode]);

    useEffect(() => {
        if (sceneRef.current) {
            sceneRef.current.scene.background = new THREE.Color(darkMode ? 0x1f2937 : 0xf5f2ec);
        }
    }, [darkMode]);

    return <div ref={mountRef} className={className || 'w-full h-[480px]'} />;
};

export default ForgeViewer;
