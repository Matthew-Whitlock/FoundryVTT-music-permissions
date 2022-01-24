#Music Permissions

Enables global and per-playlist permission configuration. Each playlist may have permissions configured the same as actors/journals (none, limited, observer, owner). Globally, you may also configure in the module settings which roles are allows to control (play/stop songs within), edit (add/remove songs from), or create playlists.

###Creating playlists
Unfortunately, permissions to create playlists are currently hard-coded in server-side. If you want to be able to use this module to choose who can create playlists, you will need to edit a FoundryVTT file and may need to redo the edits whenever Foundry replaces the file (probably just on an update).

Open the file "C:\Program Files\Foundry Virtual Tabletop\resources\app\common\documents.mjs" with a text editor with Administrator priveleges, scroll to the BasePLaylist class, and in the metadata() function insert the following onto a new line between labelPlural and embedded:

    permissions: {
      create: "PLAYER",
      update: "PLAYER"
    },

If you know you will only be allowing trusted players to create playlists, you can write TRUSTED instead of PLAYER for better security.
