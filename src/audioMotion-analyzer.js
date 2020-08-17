/*!
 * audioMotion-analyzer
 * High-resolution real-time graphic audio spectrum analyzer JS module
 *
 * @version 2.4.0
 * @author  Henrique Avila Vianna <hvianna@gmail.com> <https://henriquevianna.com>
 * @license AGPL-3.0-or-later
 */

const _VERSION = '2.4.0';

export default class AudioMotionAnalyzer {

/**
 * CONSTRUCTOR
 *
 * @param {object} [container] DOM element where to insert the analyzer; if undefined, uses the document body
 * @param {object} [options]
 * @returns {object} AudioMotionAnalyzer object
 */
	constructor( container, options = {} ) {

		this._initDone = false;

		// Gradient definitions

		this._gradients = {
			classic: {
				bgColor: '#111',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					{ pos: .6, color: 'hsl( 60, 100%, 50% )' },
					'hsl( 120, 100%, 50% )'
				]
			},
			prism:   {
				bgColor: '#111',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					'hsl( 60, 100%, 50% )',
					'hsl( 120, 100%, 50% )',
					'hsl( 180, 100%, 50% )',
					'hsl( 240, 100%, 50% )'
				]
			},
			rainbow: {
				bgColor: '#111',
				dir: 'h',
				colorStops: [
					'hsl( 0, 100%, 50% )',
					'hsl( 60, 100%, 50% )',
					'hsl( 120, 100%, 50% )',
					'hsl( 180, 100%, 47% )',
					'hsl( 240, 100%, 58% )',
					'hsl( 300, 100%, 50% )',
					'hsl( 360, 100%, 50% )'
				]
			},
		};

		// Set container
		this._container = container || document.body;

		// Make sure we have minimal width and height dimensions in case of an inline container
		this._defaultWidth  = this._container.clientWidth  || 640;
		this._defaultHeight = this._container.clientHeight || 270;

		// Use audio context provided by user, or create a new one

		const AudioContext = window.AudioContext || window.webkitAudioContext;

		if ( options.hasOwnProperty( 'audioCtx' ) ) {
			if ( options.audioCtx instanceof AudioContext )
				this._audioCtx = options.audioCtx;
			else
				throw new AudioMotionError( 'ERR_INVALID_AUDIO_CONTEXT', 'Provided audio context is not valid' );
		}
		else {
			try {
				this._audioCtx = new AudioContext();
			}
			catch( err ) {
				throw new AudioMotionError( 'ERR_AUDIO_CONTEXT_FAIL', 'Could not create audio context. Web Audio API not supported?' );
			}
		}

		// create two analyzer nodes, channel splitter and merger (for stereo mode)
		this._analyzer  = [ this._audioCtx.createAnalyser(), this._audioCtx.createAnalyser() ];
		this._splitter  = this._audioCtx.createChannelSplitter(2);
 		this._merger    = this._audioCtx.createChannelMerger(2);
 		this._dataArray = [];

 		// create audio source, if media element provided in the options
		this._audioSource = options.source ? this._audioCtx.createMediaElementSource( options.source ) : undefined;

		// initialize object to save instant and peak energy
		this._energy = { instant: 0, peak: 0, hold: 0 };

		// Create canvases

		// main spectrum analyzer canvas
		this._canvas = document.createElement('canvas');
		this._canvas.style = 'max-width: 100%;';
		this._container.appendChild( this._canvas );
		this._canvasCtx = this._canvas.getContext('2d');

		// auxiliary canvases for the X-axis scale labels
		this._labels = document.createElement('canvas');
		this._labelsCtx = this._labels.getContext('2d');
		this._circScale = document.createElement('canvas');
		this._circScaleCtx = this._circScale.getContext('2d');

		// adjust canvas on window resize
		window.addEventListener( 'resize', () => {
			if ( ! this._width || ! this._height ) // fluid width or height
				this._setCanvas('resize');
		});

		// adjust canvas size on fullscreen change
		this._canvas.addEventListener( 'fullscreenchange', () => this._setCanvas('fschange') );

		// Set configuration options and use defaults for any missing properties
		this._setProperties( options, true );

		// Finish canvas setup

		this._initDone = true;
		this._setCanvas('create');
	}

	/**
	 * ==========================================================================
	 *
	 * PUBLIC PROPERTIES GETTERS AND SETTERS
	 *
	 * ==========================================================================
	 */

	// Bar spacing (for octave bands modes)

	get barSpace() {
		return this._barSpace;
	}
	set barSpace( value ) {
		this._barSpace = Number( value ) || 0;
		this._calculateBarSpacePx();
	}

	// FFT size

	get fftSize() {
		return this._analyzer[0].fftSize;
	}
	set fftSize( value ) {
		for ( let i = 0; i < 2; i++ ) {
			this._analyzer[ i ].fftSize = value;
			this._dataArray[ i ] = new Uint8Array( this._analyzer[ i ].frequencyBinCount );
		}
		this._precalculateBarPositions();
	}

	// Gradient

	get gradient() {
		return this._gradient;
	}
	set gradient( value ) {
		if ( this._gradients.hasOwnProperty( value ) )
			this._gradient = value;
		else
			throw new AudioMotionError( 'ERR_UNKNOWN_GRADIENT', `Unknown gradient: '${value}'` );
	}

	// Canvas size

	get height() {
		return this._height;
	}
	set height( h ) {
		this._height = h;
		this._setCanvas('user');
	}
	get width() {
		return this._width;
	}
	set width( w ) {
		this._width = w;
		this._setCanvas('user');
	}

	// Visualization mode

	get mode() {
		return this._mode;
	}
	set mode( value ) {
		const mode = value | 0;
		if ( mode >= 0 && mode <= 10 && mode != 9 ) {
			this._mode = mode;
			this._precalculateBarPositions();
			if ( this._reflexRatio > 0 )
				this._generateGradients();
		}
		else
			throw new AudioMotionError( 'ERR_INVALID_MODE', `Invalid mode: ${value}` );
	}

	// Low-resolution mode

	get loRes() {
		return this._loRes;
	}
	set loRes( value ) {
		this._loRes = !! value;
		this._setCanvas('lores');
	}

	get lumiBars() {
		return this._lumiBars;
	}
	set lumiBars( value ) {
		this._lumiBars = !! value;
		if ( this._reflexRatio > 0 ) {
			this._generateGradients();
			this._calculateLedProperties();
		}
	}

	// Radial mode

	get radial() {
		return this._radial;
	}
	set radial( value ) {
		this._radial = !! value;
		this._generateGradients();
	}

	get spinSpeed() {
		return this._spinSpeed;
	}
	set spinSpeed( value ) {
		value = Number( value ) || 0;
		if ( this._spinSpeed === undefined || value == 0 )
			this._spinAngle = -Math.PI / 2; // initialize or reset the rotation angle
		this._spinSpeed = value;
	}

	// Reflex

	get reflexRatio() {
		return this._reflexRatio;
	}
	set reflexRatio( value ) {
		value = Number( value ) || 0;
		if ( value < 0 || value >= 1 )
			throw new AudioMotionError( 'ERR_REFLEX_OUT_OF_RANGE', `Reflex ratio must be >= 0 and < 1` );
		else {
			this._reflexRatio = value;
			this._generateGradients();
			this._calculateLedProperties();
		}
	}

	// Current frequency range

	get minFreq() {
		return this._minFreq;
	}
	set minFreq( value ) {
		if ( value < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._minFreq = value;
			this._precalculateBarPositions();
		}
	}
	get maxFreq() {
		return this._maxFreq;
	}
	set maxFreq( value ) {
		if ( value < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._maxFreq = value;
			this._precalculateBarPositions();
		}
	}

	// Analyzer's sensitivity

	get minDecibels() {
		return this._analyzer[0].minDecibels;
	}
	set minDecibels( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].minDecibels = value;
	}
	get maxDecibels() {
		return this._analyzer[0].maxDecibels;
	}
	set maxDecibels( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].maxDecibels = value;
	}

	// Analyzer's smoothing time constant

	get smoothing() {
		return this._analyzer[0].smoothingTimeConstant;
	}
	set smoothing( value ) {
		for ( let i = 0; i < 2; i++ )
			this._analyzer[ i ].smoothingTimeConstant = value;
	}

	// Stereo

	get stereo() {
		return this._stereo;
	}
	set stereo( value ) {
		this._stereo = !! value;

		const input  = this._stereo ? this._splitter : this._analyzer[0],
			  output = this._stereo ? this._merger   : this._analyzer[0];

		// disconnect all previous connections
		this._splitter.disconnect();
		this._merger.disconnect();

		// reconnect audio source, if it exists
		if ( this._audioSource ) {
			this._audioSource.disconnect();
			this._audioSource.connect( input );
		}

		// connect splitter -> analyzer -> merger for stereo
		if ( this._stereo ) {
			for ( let i = 0; i < 2; i++ ) {
				this._splitter.connect( this._analyzer[ i ], i );
				this._analyzer[ i ].disconnect();
				this._analyzer[ i ].connect( this._merger, 0, i );
			}
		}

		// connect output node to destination
		output.connect( this._audioCtx.destination );

		this._setCanvas(); // needed to resize the circular scale and regenerate gradients (to do)
	}

	// Read only properties

	get analyzer() {
		return this._stereo ? this._analyzer : this._analyzer[0]; // do we need retro-compatibility?
	}
	get audioCtx() {
		return this._audioCtx;
	}
	get audioSource() {
		return this._audioSource;
	}
	get canvas() {
		return this._canvas;
	}
	get canvasCtx() {
		return this._canvasCtx;
	}
	get dataArray() {
		return this._stereo ? this._dataArray : this._dataArray[0]; // do we need retro-compatibility?
	}
	get energy() {
		return this._energy.instant;
	}
	get fsWidth() {
		return this._fsWidth;
	}
	get fsHeight() {
		return this._fsHeight;
	}
	get fps() {
		return this._fps;
	}
	get isFullscreen() {
		return ( document.fullscreenElement || document.webkitFullscreenElement ) === this._canvas;
	}
	get isOn() {
		return this._animationReq !== undefined;
	}
	get peakEnergy() {
		return this._energy.peak;
	}
	get pixelRatio() {
		return this._pixelRatio;
	}
	get version() {
		return _VERSION;
	}

	/**
	 * ==========================================================================
     *
	 * PUBLIC METHODS
	 *
	 * ==========================================================================
	 */

	/**
	 * Connect HTML audio element to analyzer
	 *
	 * @param {object} element HTML audio element
	 * @returns {object} a MediaElementAudioSourceNode object
	 */
	connectAudio( element ) {
		const audioSource = this._audioCtx.createMediaElementSource( element );
		audioSource.connect( this._stereo ? this._splitter : this._analyzer[0] );
		return audioSource;
	}

	/**
	 * Returns the frequency represented by a given FFT bin
	 *
	 * @param {number} bin FFT data array index
	 * @returns {number}   Frequency in hertz
	 */
	binToFreq( bin ) {
		return bin * this._audioCtx.sampleRate / this._analyzer[0].fftSize;
	}

	/**
	 * Returns the FFT bin which more closely corresponds to a given frequency
	 *
	 * @param {number} freq       Frequency in hertz
	 * @param {string} [rounding] Rounding function: 'floor', 'round' (default) or 'ceil'
	 * @returns {number}          FFT data array index (integer)
	 */
	freqToBin( freq, rounding ) {
		if ( ! ['floor','ceil'].includes( rounding ) )
			rounding = 'round';

		const bin = Math[ rounding ]( freq * this._analyzer[0].fftSize / this._audioCtx.sampleRate );

		return bin < this._analyzer[0].frequencyBinCount ? bin : this._analyzer[0].frequencyBinCount - 1;
	}

	/**
	 * Registers a custom gradient
	 *
	 * @param {string} name
	 * @param {object} options
	 */
	registerGradient( name, options ) {
		if ( typeof name !== 'string' || name.trim().length == 0 )
			throw new AudioMotionError( 'ERR_GRADIENT_INVALID_NAME', 'Gradient name must be a non-empty string' );

		if ( typeof options !== 'object' )
			throw new AudioMotionError( 'ERR_GRADIENT_NOT_AN_OBJECT', 'Gradient options must be an object' );

		if ( options.colorStops === undefined || options.colorStops.length < 2 )
			throw new AudioMotionError( 'ERR_GRADIENT_MISSING_COLOR', 'Gradient must define at least two colors' );

		this._gradients[ name ] = {};

		if ( options.bgColor !== undefined )
			this._gradients[ name ].bgColor = options.bgColor;
		else
			this._gradients[ name ].bgColor = '#111';

		if ( options.dir !== undefined )
			this._gradients[ name ].dir = options.dir;

		this._gradients[ name ].colorStops = options.colorStops;

		this._generateGradients();
	}

	/**
	 * Set dimensions of analyzer's canvas
	 *
	 * @param {number} w width in pixels
	 * @param {number} h height in pixels
	 */
	setCanvasSize( w, h ) {
		this._width = w;
		this._height = h;
		this._setCanvas('user');
	}

	/**
	 * Set desired frequency range
	 *
	 * @param {number} min lowest frequency represented in the x-axis
	 * @param {number} max highest frequency represented in the x-axis
	 */
	setFreqRange( min, max ) {
		if ( min < 1 || max < 1 )
			throw new AudioMotionError( 'ERR_FREQUENCY_TOO_LOW', `Frequency values must be >= 1` );
		else {
			this._minFreq = Math.min( min, max );
			this._maxFreq = Math.max( min, max );
			this._precalculateBarPositions();
		}
	}

	/**
	 * Shorthand function for setting several options at once
	 *
	 * @param {object} options
	 */
	setOptions( options ) {
		this._setProperties( options );
	}

	/**
	 * Adjust the analyzer's sensitivity
	 *
	 * @param {number} min minimum decibels value
	 * @param {number} max maximum decibels value
	 */
	setSensitivity( min, max ) {
		for ( let i = 0; i < 2; i++ ) {
			this._analyzer[ i ].minDecibels = Math.min( min, max );
			this._analyzer[ i ].maxDecibels = Math.max( min, max );
		}
	}

	/**
	 * Start / stop canvas animation
	 *
	 * @param {boolean} [value] if undefined, inverts the current status
	 * @returns {boolean} resulting status after the change
	 */
	toggleAnalyzer( value ) {
		const started = this.isOn;

		if ( value === undefined )
			value = ! started;

		if ( started && ! value ) {
			cancelAnimationFrame( this._animationReq );
			this._animationReq = undefined;
		}
		else if ( ! started && value ) {
			this._frame = this._fps = 0;
			this._time = performance.now();
			this._animationReq = requestAnimationFrame( timestamp => this._draw( timestamp ) );
		}

		return this.isOn;
	}

	/**
	 * Toggles canvas full-screen mode
	 */
	toggleFullscreen() {
		if ( this.isFullscreen ) {
			if ( document.exitFullscreen )
				document.exitFullscreen();
			else if ( document.webkitExitFullscreen )
				document.webkitExitFullscreen();
		}
		else {
			if ( this._canvas.requestFullscreen )
				this._canvas.requestFullscreen();
			else if ( this._canvas.webkitRequestFullscreen )
				this._canvas.webkitRequestFullscreen();
		}
	}

	/**
	 * ==========================================================================
	 *
	 * PRIVATE METHODS
	 *
	 * ==========================================================================
	 */

	/**
	 * Calculate bar spacing in pixels
	 */
	_calculateBarSpacePx() {
		this._barSpacePx = Math.min( this._barWidth - 1, ( this._barSpace > 0 && this._barSpace < 1 ) ? this._barWidth * this._barSpace : this._barSpace );
	}

	/**
	 * Calculate attributes for the vintage LEDs effect, based on visualization mode and canvas resolution
	 */
	_calculateLedProperties() {
		// no need for this if in discrete frequencies or area fill modes
		if ( this._mode % 10 == 0 || ! this._initDone )
			return;

		const analyzerHeight = this._lumiBars ? this._canvas.height : this._canvas.height * ( 1 - this._reflexRatio ) | 0;

		let spaceV = Math.min( 6, analyzerHeight / ( 90 * this._pixelRatio ) | 0 ); // for modes 3, 4, 5 and 6
		let nLeds;

		switch ( this._mode ) {
			case 8:
				spaceV = Math.min( 16, analyzerHeight / ( 33 * this._pixelRatio ) | 0 );
				nLeds = 24;
				break;
			case 7:
				spaceV = Math.min( 8, analyzerHeight / ( 67 * this._pixelRatio ) | 0 );
				nLeds = 48;
				break;
			case 6:
				nLeds = 64;
				break;
			case 5:
				// fall through
			case 4:
				nLeds = 80;
				break;
			case 3:
				nLeds = 96;
				break;
			case 2:
				spaceV = Math.min( 4, analyzerHeight / ( 135 * this._pixelRatio ) | 0 );
				nLeds = 128;
				break;
			case 1:
				spaceV = Math.min( 3, Math.max( 2, analyzerHeight / ( 180 * this._pixelRatio ) | 0 ) );
				nLeds = 128;
		}

		spaceV *= this._pixelRatio;
		nLeds = Math.min( nLeds, ( analyzerHeight + spaceV ) / ( spaceV * 2 ) | 0 );

		this._ledOptions = {
			nLeds,
			spaceH: this._barWidth * ( this._mode == 1 ? .45 : this._mode < 5 ? .225 : .125 ),
			spaceV,
			ledHeight: ( analyzerHeight + spaceV ) / nLeds - spaceV
		};
	}

	/**
	 * Redraw the canvas
	 * this is called 60 times per second by requestAnimationFrame()
	 */
	_draw( timestamp ) {
		const canvas         = this._canvas,
			  ctx            = this._canvasCtx,
			  isOctaveBands  = ( this._mode % 10 != 0 ),
			  isLedDisplay   = ( this.showLeds  && isOctaveBands && ! this._radial ),
			  isLumiBars     = ( this._lumiBars && isOctaveBands && ! this._radial ),
			  channelHeight  = canvas.height >> this._stereo,
			  analyzerHeight = channelHeight * ( isLumiBars || this._radial ? 1 : 1 - this._reflexRatio ) | 0;

		// radial related constants
		const centerX        = canvas.width >> 1,
			  centerY        = canvas.height >> 1,
			  radius         = ( this._circScale.width >> 1 ) - ( this._stereo * this._canvas.height * .015 | 0 ),
			  tau            = 2 * Math.PI;

		if ( this._energy.instant > 0 )
			this._spinAngle += this._spinSpeed * tau / 3600;

		// helper function - convert planar X,Y coordinates to radial coordinates
		const radialXY = ( x, y ) => {
			const height = radius + y,
				  angle  = tau * ( x / canvas.width ) + this._spinAngle;

			return [ centerX + height * Math.cos( angle ), centerY + height * Math.sin( angle ) ];
		}

		// helper function - draw a polygon of width `w` and height `h` at (x,y) in radial mode
		const radialPoly = ( x, y, w, h ) => {
			ctx.moveTo( ...radialXY( x, y ) );
			ctx.lineTo( ...radialXY( x, y + h ) );
			ctx.lineTo( ...radialXY( x + w, y + h ) );
			ctx.lineTo( ...radialXY( x + w, y ) );
		}

		// clear the canvas, if in overlay mode
		if ( this.overlay ) {
			ctx.clearRect( 0, 0, canvas.width, canvas.height );
			ctx.globalAlpha = this.bgAlpha; // set opacity for background paint
		}

		// select background color
		if ( ! this.showBgColor || isLedDisplay && ! this.overlay )
			ctx.fillStyle = '#000';
		else
			ctx.fillStyle = this._gradients[ this._gradient ].bgColor;

		// fill the canvas background if needed
		if ( ! this.overlay || this.showBgColor ) {
			// exclude the reflection area when overlay is true and reflexAlpha == 1
			// (avoids alpha over alpha difference, in case bgAlpha < 1)
			ctx.fillRect( 0, 0, canvas.width, ( this.overlay && this.reflexAlpha == 1 ) ? analyzerHeight : canvas.height );
		}

		// restore global alpha
		ctx.globalAlpha = 1;

		// draw dB scale (Y-axis)
		if ( this.showScaleY && ! isLumiBars && ! this._radial ) {
			const scaleWidth  = canvas.height / 25 | 0,
				  scaleHeight = analyzerHeight - ( this.showScale && this.reflexRatio == 0 ? this._labels.height : 0 ),
				  fontSize    = scaleWidth >> 1,
				  interval    = analyzerHeight / ( this._analyzer[0].maxDecibels - this._analyzer[0].minDecibels );

			ctx.fillStyle = '#888';
			ctx.font = `${fontSize}px sans-serif`;
			ctx.textAlign = 'right';
			ctx.lineWidth = 1;

			for ( let db = this._analyzer[0].maxDecibels; db > this._analyzer[0].minDecibels; db -= 5 ) {
				const posY = ( this._analyzer[0].maxDecibels - db ) * interval,
					  even = ( db % 2 == 0 ) | 0;

				if ( even ) {
					const labelY = posY == 0 ? fontSize * .8 : posY + fontSize * .35;
					ctx.fillText( db, scaleWidth * .85, labelY );
					ctx.fillText( db, canvas.width - scaleWidth * .1, labelY );
					ctx.strokeStyle = '#888';
					ctx.setLineDash([2,4]);
					ctx.lineDashOffset = 0;
				}
				else {
					ctx.strokeStyle = '#555';
					ctx.setLineDash([2,8]);
					ctx.lineDashOffset = 1;
				}

				ctx.beginPath();
				ctx.moveTo( scaleWidth * even, posY );
				ctx.lineTo( canvas.width - scaleWidth * even, posY );
				ctx.stroke();
			}
			// restore line properties
			ctx.setLineDash([]);
			ctx.lineDashOffset = 0;
		}

		// get a new array of data from the FFT
		for ( let i = 0; i < this._stereo + 1; i++ )
			this._analyzer[ i ].getByteFrequencyData( this._dataArray[ i ] );

		// start drawing path
		ctx.beginPath();

		// in line / graph mode, line starts off screen
		if ( this._mode == 10 && ! this._radial )
			ctx.moveTo( -this.lineWidth, analyzerHeight );

		// compute the effective bar width, considering the selected bar spacing
		// if led effect is active, ensure at least the spacing defined by the led options
		let width = this._barWidth - ( ! isOctaveBands ? 0 : Math.max( isLedDisplay ? this._ledOptions.spaceH : 0, this._barSpacePx ) );

		// set line width and dash for LEDs effect
		if ( isLedDisplay ) {
			ctx.setLineDash( [ this._ledOptions.ledHeight, this._ledOptions.spaceV ] );
			ctx.lineWidth = width;
		}
		else if ( this._barSpace == 0 )
			width |= 0; // make sure width is integer for pixel accurate calculation, when no bar spacing is required

		// set selected gradient for fill and stroke
		ctx.fillStyle = ctx.strokeStyle = this._gradients[ this._gradient ].gradient;

		// draw bars / lines

		let bar, barHeight,
			energy = 0;

		const nBars = this._analyzerBars.length;

		for ( let channel = 0; channel < this._stereo + 1; channel++ ) {

			const data = this._dataArray[ channel ];

			for ( let i = 0; i < nBars; i++ ) {

				bar = this._analyzerBars[ i ];

				if ( bar.endIdx == 0 ) { // single FFT bin
					barHeight = data[ bar.dataIdx ];
					// apply smoothing factor when several bars share the same bin
					if ( bar.factor )
						barHeight += ( data[ bar.dataIdx + 1 ] - barHeight ) * bar.factor;
				}
				else { 					// range of bins
					barHeight = 0;
					// use the highest value in the range
					for ( let j = bar.dataIdx; j <= bar.endIdx; j++ )
						barHeight = Math.max( barHeight, data[ j ] );
				}

				barHeight /= 255;
				energy += barHeight;

				// set opacity for lumi bars before barHeight value is normalized
				if ( isLumiBars )
					ctx.globalAlpha = barHeight;

				if ( isLedDisplay ) { // normalize barHeight to match one of the "led" elements
					barHeight = ( barHeight * this._ledOptions.nLeds | 0 ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV ) - this._ledOptions.spaceV;
					if ( barHeight < 0 )
						barHeight = 0; // prevent showing leds below 0 when overlay and reflex are active
				}
				else
					barHeight = barHeight * ( this._radial ? centerY - radius : analyzerHeight ) | 0;

				if ( barHeight >= bar.peak[ channel ] ) {
					bar.peak[ channel ] = barHeight;
					bar.hold[ channel ] = 30; // set peak hold time to 30 frames (0.5s)
					bar.accel[ channel ] = 0;
				}

				if ( this._radial && channel == 1 )
					barHeight *= -1;

				let posX = bar.posX;
				let adjWidth = width; // bar width may need small adjustments for some bars, when barSpace == 0

				// Draw line / bar
				if ( this._mode == 10 ) {
					if ( ! this._radial )
						ctx.lineTo( bar.posX, ( analyzerHeight << channel ) - barHeight );
					else if ( bar.posX >= 0 ) // avoid overlapping wrap-around frequencies
						ctx.lineTo( ...radialXY( bar.posX, barHeight ) );
				}
				else {
					if ( this._mode > 0 ) {
						if ( isLedDisplay )
							posX += Math.max( this._ledOptions.spaceH / 2, this._barSpacePx / 2 );
						else {
							if ( this._barSpace == 0 ) {
								posX |= 0;
								if ( i > 0 && posX > this._analyzerBars[ i - 1 ].posX + width ) {
									posX--;
									adjWidth++;
								}
							}
							else
								posX += this._barSpacePx / 2;
						}
					}

					if ( isLedDisplay ) {
						const x = posX + width / 2;
						// draw "unlit" leds
						if ( this.showBgColor && ! this.overlay ) {
							const alpha = ctx.globalAlpha;
							ctx.beginPath();
							ctx.moveTo( x, 0 );
							ctx.lineTo( x, analyzerHeight << channel );
							ctx.strokeStyle = '#7f7f7f22';
							ctx.globalAlpha = 1;
							ctx.stroke();
							// restore properties
							ctx.strokeStyle = ctx.fillStyle;
							ctx.globalAlpha = alpha;
						}
						ctx.beginPath();
						ctx.moveTo( x, isLumiBars ? 0 : analyzerHeight << channel );
						ctx.lineTo( x, isLumiBars ? canvas.height : ( analyzerHeight << channel ) - barHeight );
						ctx.stroke();
					}
					else if ( ! this._radial ) {
						ctx.fillRect( posX, isLumiBars ? 0 : channelHeight * channel + analyzerHeight, adjWidth, isLumiBars ? channelHeight << channel : -barHeight );
					}
					else if ( bar.posX >= 0 ) {
						radialPoly( posX, 0, adjWidth, barHeight );
					}
				}

				// Draw peak
				if ( bar.peak[ channel ] > 0 ) {
					if ( this.showPeaks && ! isLumiBars ) {
						if ( isLedDisplay ) {
							ctx.fillRect(
								posX,
								( this._ledOptions.nLeds - bar.peak[ channel ] / ( ( analyzerHeight << channel ) + this._ledOptions.spaceV ) * this._ledOptions.nLeds | 0 ) * ( this._ledOptions.ledHeight + this._ledOptions.spaceV ),
								width,
								this._ledOptions.ledHeight
							);
						}
						else if ( ! this._radial ) {
							ctx.fillRect( posX, ( analyzerHeight << channel ) - bar.peak[ channel ], adjWidth, 2 );
						}
						else if ( this.mode != 10 && bar.posX >= 0 ) { // radial - no peaks for mode 10 or wrap-around frequencies
							radialPoly( posX, bar.peak[ channel ] * ( channel == 1 ? -1 : 1 ), adjWidth, -2 );
						}
					}

					if ( bar.hold[ channel ] )
						bar.hold[ channel ]--;
					else {
						bar.accel[ channel ]++;
						bar.peak[ channel ] -= bar.accel[ channel ];
					}
				}
			} // for ( let i = 0; i < l; i++ )

			// restore canvas properties
			ctx.globalAlpha = 1;
			ctx.setLineDash([]);

			// Update instant and peak energy
			this._energy.instant = energy / nBars;
			if ( this._energy.instant >= this._energy.peak ) {
				this._energy.peak = this._energy.instant;
				this._energy.hold = 30;
			}
			else {
				if ( this._energy.hold > 0 )
					this._energy.hold--;
				else if ( this._energy.peak > 0 )
					this._energy.peak *= ( 30 + this._energy.hold-- ) / 30; // decay
			}

			if ( this._mode == 10 ) { // fill area
				if ( this._radial )
					ctx.closePath();
				else
					ctx.lineTo( bar.posX + this.lineWidth, analyzerHeight << channel );

				if ( this.lineWidth > 0 ) {
					ctx.lineWidth = this.lineWidth;
					ctx.stroke();
				}

				if ( this.fillAlpha > 0 ) {
					if ( this._radial ) {
						// exclude the center circle from the fill area
						ctx.moveTo( centerX + radius, centerY );
						ctx.arc( centerX, centerY, radius, 0, tau, true );
					}
					ctx.globalAlpha = this.fillAlpha;
					ctx.fill();
					ctx.globalAlpha = 1;
				}
			}
			else if ( this._radial ) {
				ctx.fill();
			}

			// Reflex effect
			if ( this._reflexRatio > 0 && ! isLumiBars ) {
				let posY, height;
				if ( this.reflexFit || this._stereo ) { // always fit reflex in stereo mode
					posY   = this._stereo ? channelHeight * ( 1 - channel ) : 0;
					height = channelHeight - analyzerHeight;
				}
				else {
					posY   = canvas.height - analyzerHeight * 2;
					height = analyzerHeight;
				}

				// set alpha and brightness for the reflection
				ctx.globalAlpha = this.reflexAlpha;
				if ( this.reflexBright != 1 )
					ctx.filter = `brightness(${this.reflexBright})`;

				// create the reflection
				ctx.setTransform( 1, 0, 0, -1, 0, canvas.height );
				ctx.drawImage( canvas, 0, channelHeight * channel, canvas.width, analyzerHeight, 0, posY, canvas.width, height );

				// reset changed properties
				ctx.setTransform();
				ctx.filter = 'none';
				ctx.globalAlpha = 1;
			}

		} // for ( let channel = 0; channel < this._stereo + 1; channel++ ) {

		// draw frequency scale (X-axis)
		if ( this.showScale ) {
			if ( this._radial ) {
				ctx.save();
				ctx.translate( centerX, centerY );
				if ( this._spinSpeed != 0 )
					ctx.rotate( this._spinAngle + Math.PI / 2 );
				ctx.drawImage( this._circScale, -this._circScale.width >> 1, -this._circScale.width >> 1 );
				ctx.restore();
			}
			else
				ctx.drawImage( this._labels, 0, canvas.height - this._labels.height );
		}

		// calculate and update current frame rate

		this._frame++;
		const elapsed = timestamp - this._time;

		if ( elapsed >= 1000 ) {
			this._fps = this._frame / ( elapsed / 1000 );
			this._frame = 0;
			this._time = timestamp;
		}
		if ( this.showFPS ) {
			const size = 20 * this._pixelRatio;
			ctx.font = `bold ${size}px sans-serif`;
			ctx.fillStyle = '#0f0';
			ctx.textAlign = 'right';
			ctx.fillText( Math.round( this._fps ), canvas.width - size, size * 2 );
		}

		// call callback function, if defined
		if ( this.onCanvasDraw ) {
			ctx.save();
			ctx.fillStyle = ctx.strokeStyle = this._gradients[ this._gradient ].gradient;
			this.onCanvasDraw( this );
			ctx.restore();
		}

		// schedule next canvas update
		this._animationReq = requestAnimationFrame( timestamp => this._draw( timestamp ) );
	}

	/**
	 * Generate gradients
	 */
	_generateGradients() {

		const analyzerHeight = ( this._lumiBars && this._mode % 10 ) ? this._canvas.height : this._canvas.height * ( 1 - this._reflexRatio ) | 0;

		// for radial mode
		const centerX = this._canvas.width >> 1,
			  centerY = this._canvas.height >> 1,
			  radius  = this._circScale.width >> 1;

		Object.keys( this._gradients ).forEach( key => {
			let grad;
			if ( this._radial )
				grad = this._canvasCtx.createRadialGradient( centerX, centerY, centerY, centerX, centerY, radius );
			else if ( this._gradients[ key ].dir && this._gradients[ key ].dir == 'h' )
				grad = this._canvasCtx.createLinearGradient( 0, 0, this._canvas.width, 0 );
			else
				grad = this._canvasCtx.createLinearGradient( 0, 0, 0, analyzerHeight );

			if ( this._gradients[ key ].colorStops ) {
				this._gradients[ key ].colorStops.forEach( ( colorInfo, index ) => {
					if ( typeof colorInfo == 'object' )
						grad.addColorStop( colorInfo.pos, colorInfo.color );
					else
						grad.addColorStop( index / ( this._gradients[ key ].colorStops.length - 1 ), colorInfo );
				});
			}

			this._gradients[ key ].gradient = grad; // save the generated gradient back into the gradients array
		});
	}

	/**
	 * Precalculate the actual X-coordinate on screen for each analyzer bar
	 *
	 * Since the frequency scale is logarithmic, each position in the X-axis actually represents a power of 10.
	 * To improve performace, the position of each frequency is calculated in advance and stored in an array.
	 * Canvas space usage is optimized to accommodate exactly the frequency range the user needs.
	 * Positions need to be recalculated whenever the frequency range, FFT size or canvas size change.
	 *
	 *                              +-------------------------- canvas --------------------------+
	 *                              |                                                            |
	 *    |-------------------|-----|-------------|-------------------!-------------------|------|------------|
	 *    1                  10     |            100                  1K                 10K     |           100K (Hz)
	 * (10^0)              (10^1)   |          (10^2)               (10^3)              (10^4)   |          (10^5)
	 *                              |-------------|<--- bandWidth --->|--------------------------|
	 *                  minFreq--> 20                   (pixels)                                22K <--maxFreq
	 *                          (10^1.3)                                                     (10^4.34)
	 *                           minLog
	 */
	_precalculateBarPositions() {

		if ( ! this._initDone )
			return;

		let minLog, bandWidth;

		this._analyzerBars = [];

		if ( this._mode % 10 == 0 ) {
		// Discrete frequencies or area fill modes
			this._barWidth = 1;

			minLog = Math.log10( this._minFreq );
			bandWidth = this._canvas.width / ( Math.log10( this._maxFreq ) - minLog );

			const minIndex = this.freqToBin( this._minFreq, 'floor' );
			const maxIndex = this.freqToBin( this._maxFreq );

	 		let lastPos = -999;

			for ( let i = minIndex; i <= maxIndex; i++ ) {
				const freq = this.binToFreq( i ); // frequency represented by this index
				const pos = Math.round( bandWidth * ( Math.log10( freq ) - minLog ) ); // avoid fractionary pixel values

				// if it's on a different X-coordinate, create a new bar for this frequency
				if ( pos > lastPos ) {
					this._analyzerBars.push( { posX: pos, dataIdx: i, endIdx: 0, factor: 0, peak: [0,0], hold: [], accel: [] } );
					lastPos = pos;
				} // otherwise, add this frequency to the last bar's range
				else if ( this._analyzerBars.length )
					this._analyzerBars[ this._analyzerBars.length - 1 ].endIdx = i;
			}
		}
		else {
		// Octave bands modes

			// how many notes grouped in each band?
			let groupNotes;

			if ( this._mode == 8 )
				groupNotes = 24;
			else if ( this._mode == 7 )
				groupNotes = 12;
			else if ( this._mode == 6 )
				groupNotes = 8;
			else if ( this._mode == 5 )
				groupNotes = 6;
			else
				groupNotes = this._mode; // for modes 1, 2, 3 and 4

			// generate a table of frequencies based on the equal tempered scale

			const root24 = 2 ** ( 1 / 24 );
			const c0 = 440 * root24 ** -114; // ~16.35 Hz

			let temperedScale = [];
			let i = 0;
			let freq;

			while ( ( freq = c0 * root24 ** i ) <= this._maxFreq ) {
				if ( freq >= this._minFreq && i % groupNotes == 0 )
					temperedScale.push( freq );
				i++;
			}

			minLog = Math.log10( temperedScale[0] );
			bandWidth = this._canvas.width / ( Math.log10( temperedScale[ temperedScale.length - 1 ] ) - minLog );

			// divide canvas space by the number of frequencies (bars) to display
			this._barWidth = this._canvas.width / temperedScale.length;
			this._calculateBarSpacePx();

			let prevBin = 0;  // last bin included in previous frequency band
			let prevIdx = -1; // previous bar FFT array index
			let nBars   = 0;  // count of bars with the same index

			temperedScale.forEach( ( freq, index ) => {
				// which FFT bin best represents this frequency?
				const bin = this.freqToBin( freq );

				let idx, nextBin;
				// start from the last used FFT bin
				if ( prevBin > 0 && prevBin + 1 <= bin )
					idx = prevBin + 1;
				else
					idx = bin;

				// FFT does not provide many coefficients for low frequencies, so several bars may end up using the same data
				if ( idx == prevIdx ) {
					nBars++;
				}
				else {
					// update previous bars using the same index with a smoothing factor
					if ( nBars > 1 ) {
						for ( let i = 1; i <= nBars; i++ )
							this._analyzerBars[ this._analyzerBars.length - i ].factor = ( nBars - i ) / nBars;
					}
					prevIdx = idx;
					nBars = 1;
				}

				prevBin = nextBin = bin;
				// check if there's another band after this one
				if ( temperedScale[ index + 1 ] !== undefined ) {
					nextBin = this.freqToBin( temperedScale[ index + 1 ] );
					// and use half the bins in between for this band
					if ( nextBin - bin > 1 )
						prevBin += Math.round( ( nextBin - bin ) / 2 );
				}

				const endIdx = prevBin - idx > 0 ? prevBin : 0;

				this._analyzerBars.push( {
					posX: index * this._barWidth,
					dataIdx: idx,
					endIdx,
//					freq, // nominal frequency for this band
//					range: [ this.binToFreq( idx ), this.binToFreq( endIdx || idx ) ], // actual range of frequencies
					factor: 0,
					peak: [0,0],
					hold: [],
					accel: []
				} );

			} );
		}

		this._calculateLedProperties();

		// Create the X-axis scale in the auxiliary canvases

		const scaleHeight = this._canvas.height * .03 | 0, // circular scale height (radial mode)
			  radius      = this._circScale.width >> 1,    // this is also used as the center X and Y coordinates of the circScale canvas
			  radialY     = radius - scaleHeight * .75,    // vertical position of text labels in the circular scale
			  tau         = 2 * Math.PI,
			  freqLabels  = [ 16, 31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 ];

		// clear canvases
		this._labels.width |= 0;
		this._circScale.width |= 0;

		this._labelsCtx.fillStyle = this._circScaleCtx.strokeStyle = '#000c';
		this._labelsCtx.fillRect( 0, 0, this._labels.width, this._labels.height );

		this._circScaleCtx.arc( radius, radius, radius - scaleHeight / 2, 0, tau );
		this._circScaleCtx.lineWidth = scaleHeight;
		this._circScaleCtx.stroke();

		this._labelsCtx.fillStyle = this._circScaleCtx.fillStyle = '#fff';
		this._labelsCtx.font = `${ this._labels.height >> 1 }px sans-serif`;
		this._circScaleCtx.font = `${ scaleHeight >> 1 }px sans-serif`;
		this._labelsCtx.textAlign = this._circScaleCtx.textAlign = 'center';

		for ( const freq of freqLabels ) {
			const label = ( freq >= 1000 ) ? `${ freq / 1000 }k` : freq,
				  x     = bandWidth * ( Math.log10( freq ) - minLog );

			this._labelsCtx.fillText( label, x,	this._labels.height * .75 );

			// avoid overlapping wrap-around labels in the circular scale
			if ( x > 0 && x < this._canvas.width ) {
				const angle  = tau * ( x / this._canvas.width ),
					  adjAng = angle - Math.PI / 2, // rotate angles so 0 is at the top
					  posX   = radialY * Math.cos( adjAng ),
					  posY   = radialY * Math.sin( adjAng );

				this._circScaleCtx.save();
				this._circScaleCtx.translate( radius + posX, radius + posY );
				this._circScaleCtx.rotate( angle );
				this._circScaleCtx.fillText( label, 0, 0 );
				this._circScaleCtx.restore();
			}
		}
	}

	/**
	 * Internal function to change canvas dimensions on demand
	 */
	_setCanvas( reason ) {
		if ( ! this._initDone )
			return;

		this._pixelRatio = window.devicePixelRatio; // for Retina / HiDPI devices

		if ( this._loRes )
			this._pixelRatio /= 2;

		this._fsWidth = Math.max( window.screen.width, window.screen.height ) * this._pixelRatio;
		this._fsHeight = Math.min( window.screen.height, window.screen.width ) * this._pixelRatio;

		if ( this.isFullscreen ) {
			this._canvas.width = this._fsWidth;
			this._canvas.height = this._fsHeight;
		}
		else {
			this._canvas.width = ( this._width || this._container.clientWidth || this._defaultWidth ) * this._pixelRatio;
			this._canvas.height = ( this._height || this._container.clientHeight || this._defaultHeight ) * this._pixelRatio;
		}

		// workaround for wrong dPR reported on Android TV
		if ( this._pixelRatio == 2 && window.screen.height <= 540 )
			this._pixelRatio = 1;

		// if not in overlay mode, paint the canvas black
		if ( ! this.overlay ) {
			this._canvasCtx.fillStyle = '#000';
			this._canvasCtx.fillRect( 0, 0, this._canvas.width, this._canvas.height );
		}

		// set lineJoin property for area fill mode (this is reset whenever the canvas size changes)
		this._canvasCtx.lineJoin = 'bevel';

		// update labels canvas dimensions
		this._labels.width = this._canvas.width;
		this._labels.height = this._pixelRatio * ( this.isFullscreen ? 40 : 20 );

		// the radius of the radial analyzer is 75% of the (main) canvas height for stereo and 25% for mono
		// in stereo mode, the scale is positioned exactly between both channels, by adding the bar width (3% of main canvas height) to the scale canvas size
		this._circScale.width = this._circScale.height = this._canvas.height * ( this._stereo ? .75 : .25 ) + ( this._stereo * this._canvas.height * .03 | 0 );

		// (re)generate gradients
		this._generateGradients();

		// calculate bar positions and led options
		this._precalculateBarPositions();

		// call callback function, if defined
		if ( this.onCanvasResize )
			this.onCanvasResize( reason, this );
	}

	/**
	 * Set object properties
	 */
	_setProperties( options, useDefaults ) {

		// settings defaults
		const defaults = {
			mode        : 0,
			fftSize     : 8192,
			minFreq     : 20,
			maxFreq     : 22000,
			smoothing   : 0.5,
			gradient    : 'classic',
			minDecibels : -85,
			maxDecibels : -25,
			showBgColor : true,
			showLeds    : false,
			showScale   : true,
			showScaleY  : false,
			showPeaks   : true,
			showFPS     : false,
			lumiBars    : false,
			loRes       : false,
			reflexRatio : 0,
			reflexAlpha : 0.15,
			reflexBright: 1,
			reflexFit   : true,
			lineWidth   : 0,
			fillAlpha   : 1,
			barSpace    : 0.1,
			overlay     : false,
			bgAlpha     : 0.7,
			radial		: false,
			spinSpeed   : 0,
			stereo      : false,
			start       : true
		};

		// callback functions properties
		const callbacks = [ 'onCanvasDraw', 'onCanvasResize' ];

		// audioCtx is set only at initialization; we handle 'start' after setting all other properties
		const ignore = [ 'audioCtx', 'start' ];

		if ( useDefaults || options === undefined )
			options = Object.assign( defaults, options );

		for ( const prop of Object.keys( options ) ) {
			if ( callbacks.indexOf( prop ) !== -1 && typeof options[ prop ] !== 'function' ) // check invalid callback
				this[ prop ] = undefined;
			else if ( ignore.indexOf( prop ) === -1 ) // skip ignored properties
				this[ prop ] = options[ prop ];
		}

		if ( options.start !== undefined )
			this.toggleAnalyzer( options.start );
	}

}

/* Custom error class */

class AudioMotionError extends Error {
	constructor( code, message ) {
		super( message );
		this.name = 'AudioMotionError';
		this.code = code;
	}
}
