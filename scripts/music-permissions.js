import SocketHandler from "./network/socket-handler.js"
//import LocalSound from "./local-controls/local-sound.js"
import Settings from "./settings.js"
import { remoteAction } from "./network/util.js"

//Override to support permissions for viewing playlists
Object.defineProperty(Playlist.prototype, "visible", {
	get: function myProperty(){
		return this.permission > 0;
	}
});

//Automatically switch to remote creation if we don't have permissions.
//remote checks permissions.
Playlist.localCreate = Playlist.create;
Playlist.create = async function (data, context){
	if(game.user.isGM) return Playlist.localCreate(data, context);
	else return remoteAction("playlist-create", "GM", {data: data});
}

Playlist.prototype.localUpdate = Playlist.prototype.update;
Playlist.prototype.update = async function (data, context){
	if(game.user.isGM) return this.localUpdate(data, context);
	else return remoteAction("playlist-update", "GM", {target: this._id, data:data, context:context});
}

Playlist.prototype.localDelete = Playlist.prototype.delete;
Playlist.prototype.delete = async function (context){
	if(game.user.isGM) return this.localDelete(context);
	else return remoteAction("playlist-delete", "GM", {target: this._id, context:context});
}

PlaylistSound.prototype.localUpdate = PlaylistSound.prototype.update;
PlaylistSound.prototype.localUpdate = async function(data, config){
	if(game.user.isGM) return this.localUpdate(data, config);
	else return remoteAction("sound-update", "GM", {target: this._id, data:data, config:config});
}

//Override rendering data to show creation buttons based on permissions
PlaylistDirectory.prototype.oldData = PlaylistDirectory.prototype.getData;
PlaylistDirectory.prototype.getData = async function (options){
	let data = await this.oldData(options);
	data.canCreateEntry = Settings.can_create();
	data.canCreateFolder = Settings.can_create();
	return data;
}

Folder.oldCreate = Folder.create;
Folder.create = async function(data, context){
	if(game.user.isGM) return Folder.oldCreate(data, context);
	else return remoteAction("folder-create", "GM", {data:data});
}

Folder.prototype.localUpdate = Folder.prototype.update;
Folder.prototype.update = async function(data, context){
	if(game.user.isGM) return this.localUpdate(data, context);
	else return remoteAction("folder-update", "GM", {target:this._id, data:data, context:context});
}

Folder.prototype.localDelete = Folder.prototype.delete;
Folder.prototype.delete = async function(context){
	if(game.user.isGM) return this.localDelete(context);
	else return remoteAction("folder-remove", "GM", {target:this._id}); //Only allow non-gms to remove
}

//These are technically over-permissive, but only visually
FolderConfig.prototype._canUserView = function (user) {
	return true;
}
Object.defineProperty(FolderConfig.prototype, "isEditable", {
	get: function myProperty(){
		return true;
	}
});

PlaylistDirectory.prototype._oldActivateListeners = PlaylistDirectory.prototype.activateListeners;
PlaylistDirectory.prototype.activateListeners = function (html) {
	this._oldActivateListeners(html);

	if(game.user.isGM) return; //Already added for GMs


	//We enable callbacks for everyone, just let css handle disabling
	//for those who can't use.
	html.on("click", "a.sound-control", event => {
	      event.preventDefault();
	      const btn = event.currentTarget;
	      const action = btn.dataset.action;
	      if (!action || btn.classList.contains("disabled")) return;

	      // Delegate to Playlist and Sound control handlers
	      switch (action) {
		case "playlist-mode":
		  return this._onPlaylistToggleMode(event);
		case "playlist-play":
		case "playlist-stop":
		  return this._onPlaylistPlay(event, action === "playlist-play");
		case "playlist-forward":
		case "playlist-backward":
		  return this._onPlaylistSkip(event, action);
		case "sound-create":
		  return this._onSoundCreate(event);
		case "sound-pause":
		case "sound-play":
		case "sound-stop":
		  return this._onSoundPlay(event, action);
		case "sound-repeat":
		  return this._onSoundToggleMode(event);
	      }
	});

	html.find(".create-folder").click(ev => this._onCreateFolder(ev));
}

//Fix playlist directory removing folder ownership config option.
PlaylistDirectory.prototype._getFolderContextOptions = function () {
	let opts = DocumentDirectory.prototype._getFolderContextOptions.call(this);

	//Allow users to edit and remove folder that they originally created.
	opts.forEach(opt => {
		if( ["FOLDER.Remove", "FOLDER.Edit"].includes(opt.name) ){
			opt.condition = header =>{
				if(game.user.isGM) return true;
				const folder = game.folders.get(header.parent().data("folderId"));
				return folder.description == game.userId;
			};
		}
	});

	return opts;
}

//Fix playlist directory removing playlist ownership config option,
//allow users to manipulate playlists they originally created.
PlaylistDirectory.prototype._oldEntryContextOptions = PlaylistDirectory.prototype._getEntryContextOptions;
PlaylistDirectory.prototype._getEntryContextOptions = function() {
	const options = DocumentDirectory.prototype._getEntryContextOptions.call(this);

	//Allow users to edit and delete f that they originally created.
	options.forEach(opt => {
		if( ["OWNERSHIP.Configure", "SIDEBAR.Delete"].includes(opt.name) ){
			opt.condition = li =>{
				if(game.user.isGM) return true;
				const document = this.constructor.collection.get(li.data("documentId"));
				return document.description == game.userId;
			};
		}
	});

	//Now re-add anything that isn't in default options list by referencing the old function definition.
	const oldOptions = this._oldEntryContextOptions()

	const newOptions = oldOptions.filter(oldOpt => !options.some(opt => oldOpt.name === opt.name))
	options.unshift(...newOptions);

	return options;
}

//Show sounds within playlists based on permissions and settings.
//Unfortunately, we just have to rebuild this whole function w/ copy/paste
PlaylistDirectory.prototype._preparePlaylistData = function(playlist) {
    if ( playlist.playing ) this._playingPlaylists.push(playlist);

    // Playlist configuration
    const p = playlist.toObject(false);
    p.modeTooltip = this._getModeTooltip(p.mode);
    p.modeIcon = this._getModeIcon(p.mode);
    p.disabled = p.mode === CONST.PLAYLIST_MODES.DISABLED;
    p.expanded = this._expanded.has(p._id);
    p.css = [p.expanded ? "" : "collapsed", playlist.playing ? "playing" : ""].filterJoin(" ")
    p.canControl = Settings.can_control(game.userId, playlist) //Note: new config added to template manually.
    p.controlCSS = ( p.canControl && !p.disabled) ? "" : "disabled";
    p.canEdit = Settings.can_edit(game.userIs, playlist) //Note: new config added to template manually.

    // Playlist sounds
    const sounds = [];
    for ( let sound of playlist.sounds ) {
      if ( !Settings.can_view(sound) && !sound.playing && (!sound.pausedTime && Settings.can_control(game.userId, playlist)) ){
        continue;
      }

      // All sounds
      const s = sound.toObject(false);
      s.playlistId = playlist.id;
      s.css = s.playing ? "playing" : "";
      s.canControl = Settings.can_control(game.userId, playlist); //Note: new config added to template manually.
      s.controlCSS = s.canControl ? "" : "disabled";
      s.playIcon = this._getPlayIcon(sound);
      s.playTitle = s.pausedTime ? "PLAYLIST.SoundResume" : "PLAYLIST.SoundPlay";

      // Playing sounds
      if ( sound.sound && !sound.sound.failed && (sound.playing || s.pausedTime) ) {
        s.isPaused = !sound.playing && s.pausedTime;
        s.pauseIcon = this._getPauseIcon(sound);
        s.lvolume = AudioHelper.volumeToInput(s.volume);
        s.currentTime = this._formatTimestamp(sound.playing ? sound.sound.currentTime : s.pausedTime);
        s.durationTime = this._formatTimestamp(sound.sound.duration);
        this._playingSounds.push(sound);
        this._playingSoundsData.push(s);
      }
      sounds.push(s);
    }
    p.sounds = sounds;
    return p;
}


//Again, unfortunately copy/paste this whole function to change folder visibility.
//Only local change is to "node.visible = ... "
PlaylistDirectory.setupFolders = function(folders, documents) {
    documents = documents.filter(d => d.visible);
    const handled = new Set();
    const createNode = (root, folder, depth) => {
      return {root, folder, depth, visible: false, children: [], documents: []};
    };

    // Create the tree structure
    const tree = createNode(true, null, 0);
    const depths = [[tree]];

    // Iterate by folder depth, populating content
    for ( let depth=1; depth<=CONST.FOLDER_MAX_DEPTH+1; depth++ ) {
      const allowChildren = depth <= CONST.FOLDER_MAX_DEPTH;
      depths[depth] = [];
      const nodes = depths[depth-1];
      if ( !nodes.length ) break;
      for ( const node of nodes ) {
        const folder = node.folder;
        if ( !node.root ) { // Ensure we don't encounter any infinite loop
          if ( handled.has(folder.id) ) continue;
          handled.add(folder.id);
        }

        // Classify content for this folder
        const classified = this._classifyFolderContent(folder, folders, documents, {allowChildren});
        node.documents = classified.documents;
        node.children = classified.folders.map(folder => createNode(false, folder, depth));
        depths[depth].push(...node.children);

        // Update unassigned content
        folders = classified.unassignedFolders;
        documents = classified.unassignedDocuments;
      }
    }

    // Populate left-over folders at the root level of the tree
    for ( const folder of folders ) {
      const node = createNode(false, folder, 1);
      const classified = this._classifyFolderContent(folder, folders, documents, {allowChildren: false});
      node.documents = classified.documents;
      documents = classified.unassignedDocuments;
      depths[1].push(node);
    }

    // Populate left-over documents at the root level of the tree
    if ( documents.length ) {
      tree.documents.push(...documents);
      tree.documents.sort(this._sortStandard);
    }

    // Recursively filter visibility of the tree
    const filterChildren = node => {
      node.children = node.children.filter(child => {
        filterChildren(child);
        return child.visible;
      });
      node.visible = node.root || game.user.isGM || node.folder?.description === game.userId || ((node.children.length + node.documents.length) > 0);

      // Populate some attributes of the Folder document
      if ( node.folder ) {
        node.folder.displayed = node.visible;
        node.folder.depth = node.depth;
        node.folder.children = node.children;
      }
    };
    filterChildren(tree);
    return tree;
}



Hooks.once("init", function (){
	//Register our module settings w/ core
	Settings.init();
});

Hooks.once("ready", async function () {
	//Register our socket callback & default handlers.
	SocketHandler.init();

	//Enable local sound controls if configured so.
	//Disabled for now.
	//LocalSound._init()

	Hooks.on("updatePlaylist", function(playlist, change, info, userId){
		if('permission' in change) ui["playlists"].render(true);
	});


	//We're going to change templates for generating the HTML for the playlist directory
	let playlist_dir_template_path = "templates/sidebar/playlists-directory.html"
	game.socket.emit("template", playlist_dir_template_path, resp => {
		if ( resp.error ) console.error(resp.error);

		let html = resp.html.replace("@root.user.isGM", "sound.canControl");

		const compiled = Handlebars.compile(html);
		Handlebars.registerPartial(playlist_dir_template_path, compiled);
		_templateCache[playlist_dir_template_path] = compiled;
		ui["playlists"].render(true)
     	});

	let playlist_partial_template_path = "templates/sidebar/partials/playlist-partial.html"
	game.socket.emit("template", playlist_partial_template_path, resp => {
		if ( resp.error ) console.error(resp.error);

		let html = resp.html.replace("#if @root.user.isGM", "#if this.canEdit");
		html = html.replace("#unless @root.user.isGM", "#unless this.canControl");

		const compiled = Handlebars.compile(html);
		Handlebars.registerPartial(playlist_partial_template_path, compiled);
		_templateCache[playlist_partial_template_path] = compiled;
		ui["playlists"].render(true)
     	});
});
