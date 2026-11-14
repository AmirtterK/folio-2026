import { BufferAttribute } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Keep parts indexed and tag their material zone before merging.
export function part( geometry, id ) {
	const g = geometry.index ? geometry : mergeVertices( geometry );
	g.setAttribute( 'partId', new BufferAttribute( new Float32Array( g.attributes.position.count ).fill( id ), 1 ) );
	return g;
}
