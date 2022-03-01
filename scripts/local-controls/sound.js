import Globals from "../globals.js"

//Replacement for Sound objs that prevents updates from remote sources,
//so we can manually handle.
class SoundReplacement extends Sound {
	constructor(soundSrc){
		super(soundSrc.src);
		this.events = soundSrc.events;
		this._eventHandlerId = soundSrc._eventHandlerId;
		
		soundSrc.events = {
			end: {},
			pause: {},
			start: {},
			stop: {},
			load: {}
		}
		
		this._eventHandlerId = 1;
		for(let listName in this.events){
			for(let id in this.events[listName]){
				if(id < 4){
					delete this.events[listName][id]
				}
			}
		}
		
		if(soundSrc.playing) soundSrc.stop();
	}
	
	toSound(playlistSound){
		let sound = new Sound(this.src);
		
		sound.on("start", playlistSound._onStart.bind(playlistSound));
		sound.on("end", playlistSound._onEnd.bind(playlistSound));
		sound.on("stop", playlistSound._onStop.bind(playlistSound));
		
		playlistSound.sound = sound;
		
		this.events = {}
		if(this.playing){
			playlistSound.data.pausedTime = this.currentTime
			
			this.doing_internal = true
			this.stop()
			this.doing_internal = false //Shouldn't be necessary, but feels weird not to.
		}
	}
	
	  /**
	* Load the audio source, creating an AudioBuffer.
	* Audio loading is idempotent, it can be requested multiple times but only the first load request will be honored.
	* @param {object} [options={}]   Additional options which affect resource loading
	* @param {boolean} [options.autoplay=false]  Automatically begin playback of the audio source once loaded
	* @param {object} [options.autoplayOptions]  Additional options passed to the play method when loading is complete
	* @returns {Promise<Sound>}      The Sound once its source audio buffer is loaded
	*/
	async _load({autoplay=false, autoplayOptions={}}={}) {

		// Delay audio loading until after an observed user gesture
		if ( game.audio.locked ) {
			console.log(`${vtt} | Delaying load of sound ${this.src} until after first user gesture`);
			await new Promise(resolve => game.audio.pending.push(resolve));
		}

		// Currently loading
		if ( this.loading instanceof Promise ) await this.loading;

		// If loading is required, cache the promise for idempotency
		if ( !this.container || this.container.loadState === AudioContainer.LOAD_STATES.NONE ) {
			this.loading = this.container.load();
			await this.loading;
			this.loading = undefined;
		}

		// Trigger automatic playback actions
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		if ( autoplay ) this.play(autoplayOptions);
		this.doing_internal = doing_internal;
		return this;
	}
	
	load({autoplay=false, autoplayOptions={}}={}) {
		if(!Globals.local._doing_local_update && !this.doing_internal) return this;
		this._load({autoplay: autoplay, autoplayOptions: autoplayOptions});
	}

	
	fade(volume, {duration=1000, from, type="linear"}={}){
		if(!Globals.local._doing_local_update && !this.doing_internal) return Promise.resolve(1);
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.fade(volume, {duration: duration, from: from, type:type});
		this.doing_internal = doing_internal;
		return ret;
	}
	
	play({loop=false, offset, volume, fade=0}){
		if(!Globals.local._doing_local_update && !this.doing_internal && !this.playing) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.play({loop:loop, offset: offset, volume: volume, fade: fade});
		this.doing_internal = doing_internal;
		return ret;
	}
	
	pause(){
		if(!Globals.local._doing_local_update && !this.doing_internal) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.pause()
		this.doing_internal = doing_internal;
		return ret;
	}
	
	stop(){
		if(!Globals.local._doing_local_update && !this.doing_internal && !Globals.local._sounds_to_stop.includes(this)) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.stop();
		this.doing_internal = doing_internal;
		return ret;
	}

	//Must manually copy all static entries, like get/set.

	/* -------------------------------------------- */
	/*  Properties                                  */
	/* -------------------------------------------- */

	/**
	* A convenience reference to the sound context used by the application
	* @returns {AudioContext}
	*/
	get context() {
		return super.context;
	}

	/**
	* A reference to the audio source node being used by the AudioContainer
	* @returns {AudioBufferSourceNode|MediaElementAudioSourceNode}
	*/
	get node() {
		return super.node;
	}

	/**
	* A reference to the GainNode parameter which controls volume
	* @type {AudioParam}
	*/
	get gain() {
		return super.gain;
	}

	/**
	* The current playback time of the sound
	* @returns {number}
	*/
	get currentTime() {
		return super.currentTime
	}

	/**
	* The total sound duration, in seconds
	* @type {number}
	*/
	get duration() {
		return super.duration
	}

	/**
	* Is the contained audio node loaded and ready for playback?
	* @type {boolean}
	*/
	get loaded() {
		return super.loaded
	}

	/**
	* Did the contained audio node fail to load?
	* @type {boolean}
	*/
	get failed() {
		return super.failed
	}

	/**
	* Is the audio source currently playing?
	* @type {boolean}
	*/
	get playing() {
		return super.playing
	}

	/**
	* Is the Sound current looping?
	* @type {boolean}
	*/
	get loop() {
		return super.loop
	}
	set loop(looping) {
		super.loop = looping;
	}

	/**
	* The volume at which the Sound is playing
	* @returns {number}
	*/
	get volume() {
		return super.volume
	}
	set volume(value) {
		super.volume = value
	}
}

export default SoundReplacement