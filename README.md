# Music Permissions

Enables global and per-playlist permission configuration. Each playlist may have permissions configured the same as actors/journals (none, limited, observer, owner). 

Globally, via module settings, you may also configure which roles are allowed to control playlists (play/stop songs within), edit playlists (add/remove songs from), or create playlists (with the additional steps below).

## Creating playlists
Unfortunately, permissions to create playlists are currently hard-coded in server-side. If you want to be able to use this module to choose who can create playlists, you will need to edit a FoundryVTT file and may need to redo the edits whenever Foundry replaces the file (probably just on an update).

Open the file `...\Foundry Virtual Tabletop\resources\app\common\documents.mjs` with an administrative text editor, scroll to the BasePLaylist class, and in the metadata() function insert the following onto a new line between labelPlural and embedded:

    permissions: {
      create: "PLAYER",
      update: "PLAYER"
    },

If you know you will only be allowing trusted players to create playlists, you can write TRUSTED instead of PLAYER for better security.
