/* global define, require */
(function (root, factory) {
	'use strict';

	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define(['seriously'], factory);
	} else if (typeof exports === 'object') {
		// Node/CommonJS
		factory(require('seriously'));
	} else {
		if (!root.Seriously) {
			root.Seriously = { plugin: function (name, opt) { this[name] = opt; } };
		}
		factory(root.Seriously);
	}
}(this, function (Seriously, undefined) {
	'use strict';

	/*
	Adapted from blend mode shader by Romain Dura
	http://mouaif.wordpress.com/2009/01/05/photoshop-math-with-glsl-shaders/
	*/

	function vectorBlendFormula(formula, base, blend) {
		function replace(channel) {
			var r = {
				base: (base || 'base') + '.' + channel,
				blend: (blend || 'blend') + '.' + channel
			};
			return function (match) {
				return r[match] || match;
			};
		}

		return 'vec3(' +
			formula.replace(/blend|base/g, replace('r')) + ', ' +
			formula.replace(/blend|base/g, replace('g')) + ', ' +
			formula.replace(/blend|base/g, replace('b')) +
			')';
	}

	var blendModes = {
		normal: 'blend',
		lighten: 'max(blend, base)',
		darken: 'min(blend, base)',
		multiply: '(base * blend)',
		average: '(base + blend / TWO)',
		add: 'min(base + blend, ONE)',
		subtract: 'max(base + blend - ONE, ZERO)',
		difference: 'abs(base - blend)',
		negation: '(ONE - abs(ONE - base - blend))',
		exclusion: '(base + blend - TWO * base * blend)',
		screen: '(ONE - ((ONE - base) * (ONE - blend)))',
		lineardodge: 'min(base + blend, ONE)',
		phoenix: '(min(base, blend) - max(base, blend) + ONE)',
		linearburn: 'max(base + blend - ONE, ZERO)', //same as subtract?

		overlay: vectorBlendFormula('base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend))'),
		softlight: vectorBlendFormula('blend < 0.5 ? (2.0 * base * blend + base * base * (1.0 - 2.0 * blend)) : (sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend))'),
		hardlight: vectorBlendFormula('base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend))', 'blend', 'base'),
		colordodge: vectorBlendFormula('blend == 1.0 ? blend : min(base / (1.0 - blend), 1.0)'),
		colorburn: vectorBlendFormula('blend == 0.0 ? blend : max((1.0 - ((1.0 - base) / blend)), 0.0)'),
		linearlight: vectorBlendFormula('BlendLinearLightf(base, blend)'),
		vividlight: vectorBlendFormula('BlendVividLightf(base, blend)'),
		pinlight: vectorBlendFormula('BlendPinLightf(base, blend)'),
		hardmix: vectorBlendFormula('BlendHardMixf(base, blend)'),
		reflect: vectorBlendFormula('BlendReflectf(base, blend)'),
		glow: vectorBlendFormula('BlendReflectf(blend, base)')
	},

	/*
	All blend modes other than "normal" effectively act as adjustment layers,
	so the alpha channel of the resulting image is just a copy of the "bottom"
	or "destination" layer. The "top" or "source" alpha is only used to dampen
	the color effect.
	*/
	mixAlpha = {
		normal: true
	};

	Seriously.plugin('accumulator', function () {
		var drawOpts = {
			clear: false
		},
		frameBuffers,
		fbIndex = 0;

		return {
			initialize: function (initialize, gl) {
				initialize();
				frameBuffers = [
					this.frameBuffer,
					new Seriously.util.FrameBuffer(gl, this.width, this.height)
				];
			},
			shader: function (inputs, shaderSource) {
				var mode = inputs.blendMode || 'normal';
				mode = mode.toLowerCase();

				shaderSource.fragment = [
					'precision mediump float;',

					'const vec3 ZERO = vec3(0.0);',
					'const vec3 ONE = vec3(1.0);',
					'const vec3 HALF = vec3(0.5);',
					'const vec3 TWO = vec3(2.0);',

					'#define BlendAddf(base, blend)			min(base + blend, 1.0)',
					'#define BlendSubtractf(base, blend)	max(base + blend - 1.0, 0.0)',
					'#define BlendLinearDodgef(base, blend)	BlendAddf(base, blend)',
					'#define BlendLinearBurnf(base, blend)	BlendSubtractf(base, blend)',
					'#define BlendLightenf(base, blend)		max(blend, base)',
					'#define BlendDarkenf(base, blend)		min(blend, base)',
					'#define BlendLinearLightf(base, blend)	(blend < 0.5 ? BlendLinearBurnf(base, (2.0 * blend)) : BlendLinearDodgef(base, (2.0 * (blend - 0.5))))',
					'#define BlendScreenf(base, blend)		(1.0 - ((1.0 - base) * (1.0 - blend)))',
					'#define BlendOverlayf(base, blend)		(base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend)))',
					'#define BlendSoftLightf(base, blend)	((blend < 0.5) ? (2.0 * base * blend + base * base * (1.0 - 2.0 * blend)) : (sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend)))',
					'#define BlendColorDodgef(base, blend)	((blend == 1.0) ? blend : min(base / (1.0 - blend), 1.0))',
					'#define BlendColorBurnf(base, blend)	((blend == 0.0) ? blend : max((1.0 - ((1.0 - base) / blend)), 0.0))',
					'#define BlendVividLightf(base, blend)	((blend < 0.5) ? BlendColorBurnf(base, (2.0 * blend)) : BlendColorDodgef(base, (2.0 * (blend - 0.5))))',
					'#define BlendPinLightf(base, blend)	((blend < 0.5) ? BlendDarkenf(base, (2.0 * blend)) : BlendLightenf(base, (2.0 *(blend - 0.5))))',
					'#define BlendHardMixf(base, blend)		((BlendVividLightf(base, blend) < 0.5) ? 0.0 : 1.0)',
					'#define BlendReflectf(base, blend)		((blend == 1.0) ? blend : min(base * base / (1.0 - blend), 1.0))',

					/*
					Linear Light is another contrast-increasing mode
					If the blend color is darker than midgray, Linear Light darkens the image
					by decreasing the brightness. If the blend color is lighter than midgray,
					the result is a brighter image due to increased brightness.
					*/

					'#define BlendFunction(base, blend) ' + blendModes[mode],
					(mixAlpha[mode] ? '#define MIX_ALPHA' : ''),

					'varying vec2 vTexCoord;',

					'uniform sampler2D source;',
					'uniform sampler2D previous;',

					'uniform float opacity;',

					'vec3 BlendOpacity(vec4 base, vec4 blend, float opacity) {',
					//apply blend, then mix by (opacity * blend.a)
					'	vec3 blendedColor = BlendFunction(base.rgb, blend.rgb);',
					'	return mix(base.rgb, blendedColor, opacity * blend.a);',
					'}',

					'void main(void) {',
					'	vec4 topPixel = texture2D(source, vTexCoord);',
					'	vec4 bottomPixel = texture2D(previous, vTexCoord);',

					'	if (topPixel.a == 0.0) {',
					'		gl_FragColor = bottomPixel;',
					'	} else {',
					'		float alpha;',
					'#ifdef MIX_ALPHA',
					'		alpha = topPixel.a * opacity;',
					'		alpha = alpha + bottomPixel.a * (1.0 - alpha);',
					'#else',
					'		alpha = bottomPixel.a;',
					'#endif',
					'		gl_FragColor = vec4(BlendOpacity(bottomPixel, topPixel, opacity), alpha);',
					'	}',
					'}'
				].join('\n');

				return shaderSource;
			},
			resize: function () {
				if (frameBuffers) {
					frameBuffers[0].resize(this.width, this.height);
					frameBuffers[1].resize(this.width, this.height);
				}
			},
			draw: function (shader, model, uniforms, frameBuffer, draw) {
				var fb;

				// ping-pong textures
				this.uniforms.previous = this.frameBuffer.texture;
				fbIndex = (fbIndex + 1) % 2;
				fb = frameBuffers[fbIndex];
				this.frameBuffer = fb;
				this.texture = fb.texture;

				if (this.inputs.clear) {
					draw(this.baseShader, model, uniforms, fb.frameBuffer, null);
					return;
				}

				draw(shader, model, uniforms, fb.frameBuffer, null, drawOpts);
			},
			destroy: function () {
				if (frameBuffers) {
					frameBuffers[0].destroy();
					frameBuffers[1].destroy();
					frameBuffers.length = 0;
				}
			}
		};
	}, {
		inPlace: false,
		title: 'Accumulator',
		description: 'Draw on top of previous frame',
		inputs: {
			source: {
				type: 'image',
				uniform: 'source'
			},
			clear: {
				type: 'boolean',
				defaultValue: false
			},
			opacity: {
				type: 'number',
				uniform: 'opacity',
				defaultValue: 1,
				min: 0,
				max: 1
			},
			blendMode: {
				type: 'enum',
				shaderDirty: true,
				defaultValue: 'normal',
				options: [
					['normal', 'Normal'],
					['lighten', 'Lighten'],
					['darken', 'Darken'],
					['multiply', 'Multiply'],
					['average', 'Average'],
					['add', 'Add'],
					['substract', 'Substract'],
					['difference', 'Difference'],
					['negation', 'Negation'],
					['exclusion', 'Exclusion'],
					['screen', 'Screen'],
					['overlay', 'Overlay'],
					['softlight', 'Soft Light'],
					['hardlight', 'Hard Light'],
					['colordodge', 'Color Dodge'],
					['colorburn', 'Color Burn'],
					['lineardodge', 'Linear Dodge'],
					['linearburn', 'Linear Burn'],
					['linearlight', 'Linear Light'],
					['vividlight', 'Vivid Light'],
					['pinlight', 'Pin Light'],
					['hardmix', 'Hard Mix'],
					['reflect', 'Reflect'],
					['glow', 'Glow'],
					['phoenix', 'Phoenix']
				]
			}
		}
	});
}));