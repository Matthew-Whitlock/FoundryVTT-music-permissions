import PlaylistDirectory from "./ui/playlist-subdir.js"
import SocketHandler from "./network/socket-handler.js"
import LocalSound from "./local-controls/local-sound.js"
import Settings from "./settings.js"

Hooks.once("init", function (){
	//Register our module settings w/ core
	Settings.init();
	
	//Tell core to use our playlists directory, not theirs.
	CONFIG.ui.playlists = PlaylistDirectory	
});


Hooks.once("ready", async function () {
	//Register our socket callback & default handlers.
	SocketHandler.init();
	
	//Enable local sound controls if configured so.
	LocalSound._init()
	
	Hooks.on("updatePlaylist", function(playlist, change, info, userId){
		if('permission' in change) ui["playlists"].render(true);
	});
	
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
});