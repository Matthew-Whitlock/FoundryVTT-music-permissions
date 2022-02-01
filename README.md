# Music Permissions

Enables global and per-playlist permission configuration. 

Each playlist may have permissions configured the same as actors/journals:
 * none: These players will be unable to see the playlist 
 * limited: By default, these players will be able to see the playlist, but not the songs within.
 * observer: By default, these players will be able to see the songs within a playlist and play/stop the playlist.
 * owner: These players can play/stop/edit the playlist and create/edit new playlists and folders.

Via module settings, you can configure a minium role to be able to:
 * Playback: Players of at least this role can control playback of playlists that they are observers of.
 * Edit: Players of at least this role can modify the contents of playlists they own, configure them, and create new playlists/folders.
 * Minimum control permission: Users with a playback-enabled role may control playback in playlists with at least this permission on.
 * Limited viewers can see songs?: Controls if limited-permissions allows a player to see the playlist name only, or also the songs within.

## Local-only playback changes
### VERY EXPERIMENTAL
There is a set of APIs (available through MusicPermissions.(API)) for changing playback for a single client.
Currently support is limited to changing your own client's settings, but that'll be fixed soon.
Additionally, for now the roles setting for local control only serves as an on/off toggle. Set to disabled 
	to disable, or any other value to allow all players to use local controls.
Please refresh all connections after enabling/disabling local controls. (Won't be necessary in the future)
 
###API Calls:
//Seed is the random number generator seed. If you want multiple people to go through a random-order
//playlist in the same order, they'll need the same seed set.
playSoundLocally(playlistId, soundId, seed = null)
//soundIds is an array.
playMultipleSoundsLocally(playlistId, soundIds, seed = null);

pauseSoundLocally(playlistId, soundId)
pauseMultipleSoundsLocally(playlistId, soundIds)

stopSoundLocally(playlistId, soundId)
stopMultipleSoundsLocally(playlistId, soundIds)

playPlaylistLocally(playlistId)
stopPlaylistLocally(playlistId)

//returns {_id:playlistId, playing: playlist.playing, sounds = [_id: soundId, playing: sound.playing, pausedTime: sound.pausedTime]}
//pausedTime is a best-effort guess, to better synchronize it'd be best to stop/play instead of playing from pause.
getPlaylistGlobalState(playlistId);

//Based on local info, not asking the user. May be very slightly old info, though pausedTime specifically 
//	may be off a bit more (though the truthiness of it should be accurate).
//Try MusicPermissions.updateLocalInfos to force everyone to update eachother's local information if you 
//	find yourself having issues. Shouldn't be needed for typical use though.
//Current support is limited to the local state, other userIds are not permitted. That will be fixed soon as well.
getPlaylistLocalState(playlistId, userId)

### Debug/Dev API calls

//In order to differentiate between some automatically-generated playlist updates (IE global state playlist 
//	continues, but you have it paused), we must declare that an upcoming command is user-generated and should
//	be forced. Normal usage does not require doing this! Buttons in the playlist directory automatically do it.
//Included for any module/script devs who call playlist.update manually.
//Workers is a single workerId string or array of strings, and determines who should listen to the force notif. 
//	"all" matches everyone.
sendRemoteForceNotif(playlistId, workers)

//These next two shouldn't need to be called, but are included here since these features are currently experimental.
//If you find issues where eg songs are playing but they don't display as that, or things are just behaving weirdly
//	call these. The second is just another method of syncing things up, it, again, shouldn't be needed. But y'know.
restorePlaylistToLocal(playlistId)
debugRestorePlaylistToLocal(playlistId)
