# Music Permissions

Enables global and per-playlist permission configuration. 

Each playlist may have permissions configured the same as actors/journals:  
 * none:     Player cannot see this Playlist  
 * limited:  Player can see this Playlist but (by default) not its contents.  
 * observer: Player can see this Playlist and its contents.  
 * owner:    Player can edit the Playlist and its contents (with an appropriate minimum role, based on settings)  

Via module settings, you can configure a minium role to be able to:  
 * Playback: Players of at least this role can control playback of playlists/songs that they can see.  
 * Edit: Players of at least this role can edit playlists they own and create new playlists/folders.  

Note: Players can delete playlists/folders that they created. They can also edit the ownership of playlists they created.

Additionally, you can configure:
 * Minimum control permission: Users with an appropriate role can control playback of playlists they have at least this ownership level of.
 * Limited viewers can see songs?: Whether users with "limited" ownership of a playlist see only the title, or also the songs

## Local-only playback changes

Removed, may investigate a simplified approach at a later time.
