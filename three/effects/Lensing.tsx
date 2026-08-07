"use client";

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { LensingEffect } from "./LensingEffect";

interface LensingProps {
	strength?: number;
	radius?: number;
	anchorPosition?: [number, number, number];
}

/** Screen-space lensing that follows the black hole's projected core. */
export function Lensing({
	strength = 1,
	radius = 0.42,
	anchorPosition = [0, 0, 0],
}: LensingProps) {
	const camera = useThree((state) => state.camera);
	const effect = useMemo(() => new LensingEffect(), []);
	const worldPosition = useMemo(() => new THREE.Vector3(), []);
	const screenPosition = useMemo(() => new THREE.Vector2(), []);

	useEffect(() => {
		effect.setStrength(strength);
		effect.setRadius(radius);
	}, [effect, radius, strength]);

	useFrame(() => {
		worldPosition.set(...anchorPosition).project(camera);
		screenPosition.set(
			worldPosition.x * 0.5 + 0.5,
			worldPosition.y * 0.5 + 0.5,
		);
		effect.setCenter(screenPosition);
	});

	return <primitive object={effect} />;
}
