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
