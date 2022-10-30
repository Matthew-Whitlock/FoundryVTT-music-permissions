import SocketHandler from "../network/socket-handler.js"
import remoteAction from "../network/util.js"
import SoundReplacement from "./sound.js"
import Globals from "./globals.js"
import Settings from "../settings.js"

//EXPERIMENTAL
class LocalSound{
	
	static playSoundsLocally(playlistId, soundId, seed = null){
		
		if(Array.isArray(soundId)){
			if(soundId.length > 1){
				return LocalSound._playMultipleSoundsLocally(playlistId, soundId, seed);
			} else if (soundId.length == 0){
				return;
			}
			soundId = soundId[0]; //Length is 1.
		}
		
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let newSounds = [];
		
		if ( [CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(playlist.mode) ){
			let localPlaylistInfo = Globals.local._user_locals_known.get(game.userId)?.get(playlistId)
			//These modes can only have one sound playing at a time. End all currently playing sounds.
			playlist.sounds.forEach(playlistSound => {
				if(playlistSound.playing || playlistSound.paused){
					if(playlistSound.id != soundId){
						newSounds.push({_id: playlistSound.id, playing: false, pausedTime: undefined})
					}
					
					let localInfo = localPlaylistInfo?.get(playlistSound.id);
					if(localInfo){
						LocalSound._rm_local_callbacks(localInfo)
						localInfo.playing = false;
					} else {
						LocalSound._add_sound_locally(playlistId, playlistSound.id, {playing: false, paused: undefined}, {playing: true, paused: undefined})
					}
				}
			});
		}
		
		newSounds.push({_id: soundId, playing: true});
		let info = Globals.local._user_locals_known.get(game.userId)?.get(playlistId)?.localPlaylistInfo?.get(SoundId)
		if(info){
			info.playing = true
			info.paused = undefined;
		} else {
			let playlistSound = playlist.sounds.get(soundId)
			LocalSound._add_sound_locally(playlistId, soundId, {playing: true, paused: playlistSound.pausedTime}, {playing: playlistSound.playing, paused: playlistSound.pausedTime})
		}
		
		let playlist_change = {_id: playlistId, playing: true, sounds: newSounds}
		if(seed != null){
			playlist_change.seed = seed;
		}
		
		LocalSound._local_update(playlist_change);

		LocalSound._attach_play_sound_callback(playlistId, soundId);
	}
	
	static stopSoundsLocally(playlistId, soundId){
		let soundIdArray = Array.isArray(soundId) ? soundId : [soundId];
		return LocalSound._stopMultipleSoundsLocally(playlistId, soundIdArray);
	}
	
	static pauseSoundsLocally(playlistId, soundId){
		let soundIdArray = Array.isArray(soundId) ? soundId : [soundId]
		return LocalSound._pauseMultipleSoundsLocally(playlistId, soundIdArray);
	}
	
	static playPlaylistLocally(playlistId, seed = null){
		let playlist = game.playlists.get(playlistId);
		if(!playlist) return;

		//Currently foundry doesn't support playing a playlist in simultaneous (soundboard) mode, so for consistency we won't here either.		
		if ( !([CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(this.mode)) ) return;

		const paused = playlist.sounds.find(s => s.data.pausedTime);
        const nextId = paused?.id || playlist.playbackOrder[0];
		LocalSound.playSoundsLocally(playlistId, nextId, seed);
	}
	
	static stopPlaylistLocally(playlistId){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let soundIds = playlist.sounds.map(sound => sound.id)
		LocalSound.stopSoundsLocally(playlistId, soundIds, true)
	}
	
	//returns {_id:playlistId, playing: playlist.playing, sounds = [_id: soundId, playing: sound.playing, pausedTime: sound.pausedTime]}
	//pausedTime is a best-effort guess, to better synchronize it'd be best to stop/play instead of playing from pause.
	static getPlaylistGlobalState(playlistId){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let state = {_id: playlistId, playing: false, sounds: []};
		
		let myLocal = Globals.local._user_locals_known.get(game.userID)?.get(playlistId)
		playlist.sounds.forEach(sound => {
			let info = myLocal?.get(sound.id);
			if(info){
				state.sounds.push({playing: info.global.playing, pausedTime: info.global.paused})
				if(info.global.playing) state.playing = true;
			} else {
				state.sounds.push({playing: sound.playing, pausedTime: sound.pausedTime})
				if(sound.playing) state.playing = true;
			}
		});
		return state;
	}
	
	//Based on local info, not asking the user. May be very slightly old info, though pausedTime specifically may be off a bit more (though the truthiness of it should be accurate).
	//Try LocalSound.updateLocalInfos to force everyone to update eachother's local information if you find yourself having issues. Shouldn't be needed for typical use though.
	static getPlaylistLocalState(playlistId, userId){
		let playlist = game.playlists.get(playlistId);
		if(!playlist) return;
		
		globalState = LocalSound.getPlaylistGlobalState(playlistId);
		
		let userInfo = Globals.local._user_locals_known.get(userId)?.get(playlistId);
		if(!userInfo) return globalState;
		for( [soundId, info] in userInfo ){
			let idx = globalState.sounds.findIndex(sound => sound._id == soundId);
			if(idx == -1) continue;
			let globalInfo = globalState.sounds[idx];
			globalInfo.playing = info.playing;
			globalInfo.pausedTime = info.paused;
		}
		return globalState
	}
	
	static sendRemoteForceNotif(playlistId, workers){
		if(Settings.min_locals_role() == 5) return;
		
		remoteAction("force-notif", workers, {target: playlistId})
		
		if(workers.includes("all") || workers.includes(game.userId)) Globals.local._force_next_reqs.push({playlistId: playlistId, userId: game.userId});
	}
	
	//Requests that userIds broadcast their local info to everyone. "all" just have everyone update eachother.
	static updateLocalInfos(userIds = ["all"]){
		game.socket.emit("module.music-permissions", {action: "update-local-info", worker: userIds});
	}
	
	static restorePlaylistToLocal(playlistId, second_run = false){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return
		
		let isPlaying = false;
		let soundChanges = []
		let realSoundChanges = []
		let localPlaylist = Globals.local._user_locals_known.get(game.userId)?.get(playlist.id);
		playlist.sounds.forEach(sound => {
			if(sound.pausedTime != sound.sound.pausedTime || sound.playing != sound.sound.playing){
				soundChanges.push({_id: sound.id, playing: sound.sound.playing, pausedTime: sound.sound.pausedTime})
			}
			if(sound.sound.playing) isPlaying = true
			
			let localSound = localPlaylist?.get(sound.id)
			if(!localSound) return;
			if(localSound.pauseTime != sound.sound.pausedTime || localSound.playing != sound.sound.playing){
				if(!Globals.local._caught_interleaving){
					console.log("LocalSound: Warning, found a sound with a different state than our local changes suggest. Please report to the github!")
					console.log("LocalSound: Bad state on playlist: \"" + playlistId + "\" sound: \"" + sound.id + "\". Dumping status below:");
					console.log(game.playlists)
					console.log(Globals.local._user_locals_known.get(game.userId))
				}
				realSoundChanges.push({_id: sound.id, playing: localSound.playing, pausedTime: localSound.paused});
			}
		});
		let doRender = Globals.local._render_on_local_updates; //Don't render after this update if the caller requested so.
		let isReal = false; //This update isn't "real", ie we don't need to change the underlying sound state, just the playlist/playlistSound status.
		LocalSound._local_update({_id: playlistId, playing: isPlaying, sounds: soundChanges}, doRender, isReal, second_run)
		
		if(realSoundChanges.length > 0){
			isReal = true; //These changes need to be propogated to the underlying sound states
			LocalSound._local_update({_id: playlistId, playing: isPlaying, sounds: realSoundChanges}, doRender, isReal, second_run)
		}
		
		if(Globals.local._caught_interleaving) Globals.local._caught_interleaving = false;
	}

	static _init(){
		let setting_config = game.settings.settings.get("music-permissions.min-locals-role")
		setting_config.onChange = (new_min_role) => {
			if(new_min_role == 5 && LocalSound._enabled){
				LocalSound._disable_local_sounds();
			} else if (new_min_role != 5 && !LocalSound._enabled){
				LocalSound._enable_local_sounds();
			} else {
				ui["playlists"].render(true);
			}
			if(game.user.isGM) LocalSound.updateLocalInfos();
		}
		
		if(Settings.min_locals_role() != 5){
			LocalSound._enable_local_sounds();
			if(game.user.isGM) LocalSound.updateLocalInfos();
		}

		//Now we expose our API!
		game.modules.get("music-permissions").api = {
			//Declared here for convenience.
			//All soundId inputs can be a single string, or an array of strings.
			
			//playSoundsLocally(playlistId, soundId, seed = null)
			//seed is the random number generator seed, null indicates no change.
			//    (used to order songs in shuffled playlists)
			playSoundsLocally: LocalSound.playSoundsLocally,
			
			//stopSoundsLocally(playlistId, soundId)
			stopSoundsLocally: LocalSound.stopSoundsLocally,
			
			//pauseSoundsLocally(playlistId, soundId)
			pauseSoundsLocally: LocalSound.pauseSoundsLocally,
			
			//playPlaylistLocally(playlistId, seed = null)
			//seed as in playSoundsLocally.
			playPlaylistLocally: LocalSound.playPlaylistLocally,
			
			//stopPlaylistLocally(playlistId)
			stopPlaylistLocally: LocalSound.stopPlaylistLocally,
			
			//getPlaylistGlobalState(playlistId)
			//returns {_id:playlistId, playing: playlist.playing, sounds = [_id: soundId, playing: sound.playing, pausedTime: sound.pausedTime]}
			//Keep in mind foundry does not guarantee simultaneous playback, different people may have different pause times.
			getPlaylistGlobalState: LocalSound.getPlaylistGlobalState,
			
			//getPlaylistLocalState(playlistId, userId)
			//Returns as getPlaylistGlobalState, but indicates the current local state of userId.
			//Does NOT accept an array of userIds.
			getPlaylistLocalState: LocalSound.getPlaylistLocalState,
			
			//sendRemoteForceNotif(playlistId, userId)
			//Informs userIds to accept the next incoming remote update, overriding local settings.
			//Sent by default in standard playlist tab buttons.
			sendRemoteForceNotif: LocalSound.sendRemoteForceNotif,
			
			//updateLocalInfos(userIds = ["all"])
			//Requests userIds to broadcast their local states, allowing everyone to update their state.
			//Broadcasts happen often on sound changes, so info should be reasonably up-to-date, only use if you're
			//  sure you need it.
			updateLocalInfos: LocalSound.updateLocalInfos,
			
			//restorePlaylistToLocal(playlistId, second_run = false)
			//Traverses the playlist to ensure all underlying sounds the playlist data
			//  align with the correct local information. Ideally uneccessary for you to call,
			//  but left here until code is better tested. May be removed from public API on updates.
			restorePlaylistToLocal: LocalSound.restorePlaylistToLocal,
			
			debug: {
				_broadcast_local_sounds: LocalSound._broadcast_local_sounds
			}
		}

	}

	static _enabled = false;
	
	//isReal=false to locally update w/o changing sound states (IE when fixing playlist from a rejected remote update)
	static _local_update(update, render = null, isReal = null, second_run = false){
		if(render === null) render = Globals.local._render_on_local_updates
		if(isReal === null) isReal = Globals.local._handling_real_updates;
		if(isReal) Globals.local._doing_local_update = true;
		try {
			let opts = {}
			if(!render) opts.render = false;
			//console.log("Starting local update, is real: " + isReal);
			if(isReal){
				let playlist = game.playlists.get(update._id);
				let localPlaylistInfo = Globals.local._user_locals_known.get(game.userId)?.get(update._id);
				update.sounds?.forEach(soundChange => {
					let playlistSound = playlist?.sounds.get(soundChange._id);
					if(!playlistSound) return;
					
					if((playlistSound.playing || playlistSound.paused) && (!soundChange.playing && !soundChange.pausedTime)){
						//We currently show this sound as playing and want to stop it
						Globals.local._sounds_to_stop.push(playlistSound.sound);
					}
				});
			}
			globalThis.CONFIG.DatabaseBackend._handleUpdateDocuments({request: {type: "Playlist", options: opts, pack: null}, result: [update], userId: "local"});
			if(isReal) Globals.local._doing_local_update = false;
		} catch (err){
			if(!second_run) LocalSound.restorePlaylistToLocal(update.id, true);
			Globals.local._sounds_to_stop = [];
			if(isReal) Globals.local._doing_local_update = false;
			throw(err);
		}
	}
	
	static _rm_local_callbacks(soundInfo){
		let callbacks = soundInfo?.callbackIds;
		if(!callbacks) return;
		
		let sound = soundInfo.soundSrc;
		if(!sound) return;
		
		for( [name, id] in callbacks ){
			sound.off(name, id);
		}
		
		callbacks.clear();
	}
	
	//soundInfo = {playing: bool, paused: bool, callbackIds: map(callback name, callbackId)}
	static _add_sound_locally(playlistId, soundId, soundInfo, globalState){
		let my_locals = Globals.local._user_locals_known.get(game.userId)
		if(!my_locals){
			my_locals = new Map();
			Globals.local._user_locals_known.set(game.userId, my_locals)
			my_locals.set(playlistId, new Map());
			my_locals.get(playlistId).set(soundId, {});
		}
		
		let my_playlists = my_locals.get(playlistId);
		if(!my_playlists){
			my_playlists = new Map();
			my_locals.set(playlistId, my_playlists);
		}
		
		soundInfo.global = globalState;
		my_playlists.set(soundId, soundInfo);
	}
	
	static _del_multiple_sounds_locally(playlistId, soundIds){
		if(!soundIds || soundIds.length == 0) return;
		let sounds = Globals.local._user_locals_known.get(game.userId)?.get(playlistId);
		if(!sounds) return;
		
		soundIds.forEach(soundId => {
			if(!sounds) return; //May have deleted this playlist already
			LocalSound._rm_local_callbacks(sounds.get(soundId));		
			sounds.delete(soundId);
			if(sounds.length == 0){
				my_locals.delete(playlistId);
			}
		});
	}
	
	static _del_sound_locally(playlistId, soundId){
		if(!soundId) return;
		LocalSound._del_multiple_sounds_locally(playlistId, [soundId]);
	}
	
	static _del_playlist_locally(playlistId){
		let toDel = game.playlists.get(playlistId)?.sounds?.map(sound => sound.id);
		LocalSound._del_multiple_sounds_locally(playlistId, toDel);
	}
	
	//Add extra_namespace to also broadcast to another module. //TODO
	static _broadcast_local_sounds(){
		let mySounds = JSON.stringify(Globals.local._user_locals_known.get(game.userId), (key, value) => {
			if(key == "callbackIds") return undefined;
			
			if(value instanceof Map) {
				console.log("Map key: " + key)
				return {
					dataType: 'Map',
					value: Array.from(value.entries())
				};
			} else if(value instanceof Sound) {
				return undefined;
			} else {
				return value;
			}
		}, 2);
		
		console.log(mySounds)
		return mySounds;
		
	}
	
	//TODO
	static _handle_sounds_update(msg){
		
	}
	
	static _attach_play_sound_callback(playlistId, soundId){
		let playlist = game.playlists.get(playlistId)
		let soundSrc = playlist?.sounds.get(soundId).sound;
		if(!soundSrc) return;
		
		soundSrc.events = {
			end: {},
			pause: {},
			start: {},
			stop: {},
			load: {}
		}; //This probably isn't the best way to do this...
		   //TODO: See if we can just not transfer hooks from the original Sound to LocalSoundSound
		   //Ideally we don't erase any events other modules have attached. Seems a bit unlikely that they would have though.
		
		function callback_template_end(soundId, baseSoundObj) {
			if ( ![CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(this.mode) ){
				//Either soundboard mode or some new mode, just stop this sound.
				LocalSound.stopSoundLocally(this.id, soundId);
				return;
			}

			// Determine the next sound
			if ( !soundId ) {
			  const current = this.sounds.find(s => s.playing);
			  soundId = current?.id || null;
			}
			let next = this._getNextSound(soundId).id;
			if ( !this.data.playing ) next = null;

			
			// Enact playlist updates
			LocalSound.playSoundsLocally(this.id, next);
		}
		
		let callback_end = callback_template_end.bind(playlist, soundId);
		let callbackId = soundSrc.on("end", callback_end, {once: true});


		let soundInfo = Globals.local._user_locals_known.get(game.userId)?.get(playlistId)?.get(soundId)
		if(!soundInfo){
			//This shouldn't happen!
			console.log("Music Permissions Error: Attaching callback to sound not playing locally. Please report this to the github!");
			soundSrc.off("end", callbackId);
		}
		
		LocalSound._rm_local_callbacks(soundInfo);
		soundInfo.soundSrc = soundSrc;
		if(!soundInfo.callbackIds) soundInfo.callbackIds = new Map();
		soundInfo.callbackIds.set("end", callbackId);
	}
	
	static _playMultipleSoundsLocally(playlistId, soundIds, seed = null){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		if(playlist.mode != CONST.PLAYLIST_MODES.SIMULTANEOUS) return;
		
		let oldSoundStates = new Map()
		let newSounds = soundIds.map(soundId => {
			if(!Globals.local._user_locals_known.get(playlistId)?.get(soundId)){
				oldSoundStates.set(soundId, {playing: playlist.sounds.get(soundId).playing, paused: playlist.sounds.get(soundId).pausedTime})
			}
			return {_id: soundId, playing: true}
		});
		playlist_change = {_id: playlistId, playing: true, sounds: newSounds}
		if(seed) playlist_change.seed = seed;
		
		LocalSound._local_update(playlist_change);
		
		soundIds.forEach(soundId => {
			let local_sound_info = Globals.local._user_locals_known.get(playlistId)?.get(soundId)
			if(local_sound_info){
				local_sound_info.playing = true;
			} else {
				LocalSound._add_sound_locally(playlistId, soundId, {playing: true, paused: oldSoundStates.get(soundId).paused}, oldSoundStates.get(soundId));
			}
			LocalSound._attach_play_sound_callback(playlistId, soundId);
		});
	}
	
	static _stopMultipleSoundsLocally(playlistId, soundIds, playlistStop = false){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let my_locals = Globals.local._user_locals_known.get(game.userId)
		
		
		soundIds.forEach(soundId => {
			let info = my_locals?.get(playlistId)?.get(soundId)
			if(info){
				LocalSound._rm_local_callbacks(info)
				info.playing = false;
				if(!playlistStop) info.paused = undefined;
			} else {
				let sound = playlist.sounds.get(soundId)
				let pausedInfo = playlistStop ? sound.pausedTime : undefined;
				LocalSound._add_sound_locally(playlistId, soundId, {playing: false, paused: pausedInfo}, {playing: sound.playing, paused: sound.pausedTime});
			}
		})
		
		let playing = false;
		for(const [playlistSoundId, playlistSound] in playlist.sounds){
			if(!soundIds.includes(playlistSoundId) && playlistSound.playing){
				playing = true;
				break;
			}
		}
		
		let soundChanges = soundIds.map( soundId => { return{_id: soundId, playing: false}})
		if(!playlistStop) soundChanges.forEach(soundChange => soundChange.pausedTime = undefined);
		
		LocalSound._local_update({_id: playlistId, playing: playing, sounds: soundChanges})
	}
	
	static _pauseMultipleSoundsLocally(playlistId, soundIds){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		let playlistSounds = playlist?.sounds
		if(!playlistSounds) return;
		
		let playlistInfo = Globals.local._user_locals_known.get(game.userId)?.get(playlistId)
		soundIds.forEach(soundId => {
			let info = playlistInfo?.get(soundId)
			let sound = playlistSounds?.get(soundId);
			if(!sound) return;
			
			if(info){
				LocalSound._rm_local_callbacks(info)
				info.playing = false;
				info.paused = sound.sound.currentTime;
			} else {
				let sound = playlist.sounds.get(soundId)
				LocalSound._add_sound_locally(playlistId, soundId, {playing: false, paused: sound.sound.currentTime}, {playing: sound.playing, paused: sound.data.pausedTime});
			}
		})
		
		let playing = false;
		playlistSounds.find(playlistSound =>{
			if(!soundIds.includes(playlistSound.id) && (playlistSound.playing || playlistSound.pausedTime)){
				playing = true;
				return true;
			}
		});
		
		let changes = soundIds.filter(soundId => playlistSounds.get(soundId)?.playing);
		changes = changes.map(soundId => {return {_id: soundId, playing: false, pausedTime: playlistSounds.get(soundId).sound.currentTime}})
		
		LocalSound._local_update({_id: playlistId, playing: playing || changes.length > 0, sounds: changes})
	}
	
	static _disable_local_sounds(){
		Globals.local._event_handlers.forEach(evt => {
			Hooks.off(evt.label, evt.idx);
		});
		
		Globals.local._socket_handlers.forEach(evt => {
			SocketHandler.deregisterHandler(evt.actions, evt.idx);
		});
		
		game.audio.pending = []//Remove any of the old SoundReplacement objs scheduled to play
		
		game.playlists.forEach(playlist => {
			playlist.sounds.forEach(sound => {
				sound.sound.toSound(sound); //lol
				if(sound.playing){
					sound.sync()
				}
			})
		})
		
		ui["playlists"].render(true);
		LocalSound._enabled = false;
	}
	
	static _enable_local_sounds(){
		
		let idx = Hooks.on("updatePlaylist", function(playlist, change, info, userId){
			change.sounds?.forEach(soundChange => {
				if("path" in soundChange){
					//sound.sound was replaced with a new Sound, not our SoundReplacement.
					let sound = game.playlists.get(playlist.id)?.sounds?.get(soundChange._id)
					if(!sound) return;
					sound.sound = new SoundReplacement(sound.sound);
					if(sound.playing){
						Globals.local._doing_local_update = true;
						sound.sync()
						Globals.local._doing_local_update = true;
					}
				}
			})
			
			if(userId != "local"){
				if(Globals.local._doing_local_update){
					console.log("Music Permissions: A remote update ran in the middle of a local one, changes were pushed to sounds :( Should be fine, but poorly tested.")
					Globals.local.caught_interleaving = true;
				}
				Globals.local._render_on_local_updates = false;
				LocalSound._handle_remote_change(playlist, change, userId);
				Globals.local._render_on_local_updates = true;
			}
		});
		
		Globals.local._event_handlers.push({idx: idx, label: "updatePlaylist"});
		
		idx = Hooks.on("updatePlaylistSound", function(playlistSound, change, info, userId){
			if("path" in change){
				//playlistSound.sound was replaced with a new Sound, not our SoundReplacement.
				playlistSound.sound = new SoundReplacement(playlistSound.sound);
				if(playlistSound.playing){
					Globals.local._doing_local_update = true;
					playlistSound.sync()
					Globals.local._doing_local_update = false;
				}
			}

			
			if(userId != "local"){
				if(Globals.local._doing_local_update){
					console.log("Music Permissions: A remote update ran in the middle of a local one, changes were pushed to sounds :(")
					Globals.local.caught_interleaving = true;
				}
				Globals.local._render_on_local_updates = false;
				LocalSound._handle_remote_change(playlistSound, change, userId, true);
				Globals.local._render_on_local_updates = true;
			}
		});
		
		Globals.local._event_handlers.push({idx: idx, label: "updatePlaylistSound"});
		
		idx = Hooks.on("createPlaylistSound", function(sound, options, userId){ //TODO: test that this actually works.
			sound.sound = new SoundReplacement(sound.sound);
		})
		
		Globals.local._event_handlers.push({idx: idx, label: "createPlaylistSound"});
		
		idx = SocketHandler.registerHandler({
			actions: ["force-notif"],
			gm: false,
			func: (msg) => {
				if(Settings.min_locals_role() == 5) return;
				Globals.local._force_next_reqs.push({playlistId: msg.data.target, userId: msg.src});
			}
		});
		Globals.local._socket_handlers.push({idx: idx, actions: ["force-notif"]})
		
		game.audio.pending = []//Remove any of the old Sound objs scheduled to play
		
		game.playlists.forEach(playlist => {
			playlist.sounds.forEach(sound => {
				sound.sound = new SoundReplacement(sound.sound);
				if(sound.playing){
					Globals.local._doing_local_update = true;
					sound.sync()
					Globals.local._doing_local_update = false;
				}
			})
		})
		
		ui["playlists"].render(true);
		LocalSound._enabled = true;
	}
	
	static _handle_remote_change(playlist, change, userId, playlistSound = false){
		//Since the update wasn't local, no changes were made to the actual playing sounds
		//So if they should have been, we just run the change again and update our internal stuff.
		//We need to undo the changes in the playlist info by formatting and sending an undo change, or we 
		//	end up with changes not being applied to the underlying sounds.
		
		console.log("In handle remote changes!")
		if(playlistSound){
			//This is from a PlaylistSound update, so we'll reform the change to play nicely.
			let playlistSound = playlist;
			playlist = playlistSound.parent
			
			let playlistSoundChange = change;
			change = {_id: playlist.id, sounds: [playlistSoundChange]}
		}
		
		LocalSound.restorePlaylistToLocal(playlist.id);
		
		if(change.sounds.length < 1){
			Console.log("Music Permissions: Warning, got playlist update w/ no sound info. Weird.")
			return;
		}
		
		let removed_one = false; //Only remove one if we have had multiple requests to force.
		Globals.local._force_next_reqs = Globals.local._force_next_reqs.filter(toForce => {
			if(!removed_one && toForce.playlistId == playlist.id && toForce.userId == userId){
				removed_one = true;
				return false;
			}
			return true;
		})
		
		if(removed_one){
			console.log("Got forced remote update!")
			//This update should be forced through.
			if([CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(playlist.mode)){
				//Only one thing should play at a time, so we accept all changes suggested. Easy!
				let nowPlaying = change.sounds.filter(soundChange => {return soundChange.playing == true});
				if(nowPlaying.length > 0) {
					if(nowPlaying.length > 1) console.log("LocalSound: Warning, got remote request to play multiple songs on sequential/shuffle playlist. Only playing first.");
					LocalSound.playSoundsLocally(playlist.id, nowPlaying[0]._id)
					LocalSound._del_playlist_locally(playlist.id);
				} else {
					let attempted_changes = change.sounds.map(sChange => sChange._id)
					let changed_sounds = playlist.sounds.filter(sound => sound.playing).map(sound => sound.id).filter(soundId => attempted_changes.includes(soundId));
					if(change.sounds[0].pausedTime){
						//Pause any song locally playing. Should just be one for this playlist mode, but just in case handle the case of multiple.
						LocalSound.pauseSoundsLocally(playlist.id, changed_sounds)
					} else {
						//stop any song locally playing or paused. Should just be one for this playlist mode, but just in case handle the case of multiple.
						LocalSound.stopSoundsLocally(playlist.id, changed_sounds)
					}
					let localPlaylist = Globals.local._user_locals_known.get(game.userId)?.get(playlist.id);
					LocalSound._del_multiple_sounds_locally(playlist.id, changed_sounds) //Remove from locally-changed anything that we just updated to match global.
				}
			} else {
				//Apply all changes, no worries.
				LocalSound._local_update(change);
				
				let localPlaylist = Globals.local._user_locals_known.get(game.userId)?.get(playlist.id)
				change.sounds.map(sound => sound.soundId).forEach(soundId => localPlaylist?.delete(soundId));
			}
		} else {
			//This is an update that shouldn't be forced through.
			//Should just be a play update, those are the only auto ones?
			if(!Globals.local._user_locals_known.get(game.userId)?.get(playlist.id)){
				//Only handle the play if we don't have any local changes to playlist.
				LocalSound._local_update(change)
				LocalSound._del_playlist_locally(playlist.id);
			} //TODO: else, update info.global for any infos we have that we're ignoring changes to.
			
		}
	}

}

export default LocalSound
