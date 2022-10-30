import Settings from "../settings.js"

class SocketHandler {
	constructor(){};
	
	//action -> [{n: handler_num, func:action_handler(msg)}]]
	static _handlers = new Map();
	static _gm_handlers = new Map();
	static _handler_num = 0;
	
	static _add_to_handlers(handler, action, func, id){
		let handler_list = handler.get(action);
		if(!handler_list){
			handler_list = []
			handler.set(action, handler_list)
		}
		handler_list.push({id: id, func: func})
	}
	
	static registerHandler({actions = [], gm = false, func}){
		if(!func || !actions || actions.length == 0) return;
		let id = ++SocketHandler._handler_num;
		actions.forEach(action => {
			if(!action) return;
			SocketHandler._add_to_handlers(gm ? SocketHandler._gm_handlers : SocketHandler._handlers, action, func, id);
		});
		return id;
	}
	
	static deregisterHandler({actions = [], id}){
		if(!id || !actions || !actions.length == 0) return;
		actions.forEach(action => {
			_handlers.get(action)?.filter(handler => handler.id != id);
			_gm_handlers.get(action)?.filter(handler => handler.id != id);
		});
	}
	
	
	
	static _handle_action({gm, msg}){
		let handlers = null
		if(gm){
			handlers = SocketHandler._gm_handlers.get(msg.action);
		} else {
			handlers = SocketHandler._handlers.get(msg.action);
		}
			
		if(!handlers) return []
		
		let errs = handlers.map(handler => handler.func(msg));
		return errs
	}
	
	static handleSocketEvent(msg){
		let handle = msg.worker.includes(game.userId) || msg.worker.includes("all")
		let handle_gm = game.user.isGM && handle
		
		let errs = [];
		if(handle_gm){
			errs = SocketHandler._handle_action({
				gm: true,
				msg: msg
			});
		}
		
		if(handle){
			errs = errs.concat(SocketHandler._handle_action({
				gm: false,
				msg: msg
			}));
		}
		
		if(!errs || errs.length == 0) return;
		errs.forEach( err => {
			if(!err || err == "") return;
			game.socket.emit("module.music-permissions", {
				worker: msg.src,
				action: "error",
				data: err
			});
		});
	}
		
	static init(){
		//Register default handlers:
		SocketHandler.registerHandler({
			actions: ["error"],
			gm: false,
			func: (msg) => {
				ui.notifications.error(msg.data);
			}
		});
		
		SocketHandler.registerHandler({
			actions: ["folder-create", "folder-update", "folder-remove"],
			gm: true,
			func: (msg) => {
				if(msg.action == "folder-create"){
					if(!Settings.can_create(msg.src)) return "You do not have permission to create folders!"
					if(msg.data.data.type != "Playlist") return "You are not allowed to edit folders outside of the playlist directory!";
				
					msg.data.data.description = msg.src; //No permissions on folder objects, just record the creator so they can edit as well as GMs.
					Folder.create(msg.data.data);
					return
				}

				let folder = game.folders.get(msg.data.target);
				console.log(folder)
				if(!Settings.can_edit(msg.src)) return "You do not have permission to edit folders!";
				if(!Settings.can_edit(msg.src, folder)) return "You cannot edit folders you did not create!";
				if(folder.data.type != "Playlist") return "You are not allowed to edit folders outside of the playlist directory!";
			
				switch (msg.action) {
					case "folder-update":
						folder.update(msg.data.data, msg.data.context);
						break;
					case "folder-remove":
						folder.delete({deleteSubfolders: false, deleteContents: false});
						break;
					default:
				}
			}
		});

		//Need to handle the case that a user has limited or observer permissions, but 
		SocketHandler.registerHandler({
			actions: ["playlist-update", "playlist-create", "playlist-delete"],
			gm: true,
			func: (msg) => {
				if(msg.action == "playlist-create"){
					if(!Settings.can_create(msg.src)) return "You do not have permission to create playlists!";

					msg.data.data.description = msg.src; //Record real creator, so they can update permissions
					
					Playlist.create(msg.data.data, {renderSheet: false}).then(function(playlist){
						let perms = {};
						perms[msg.src] = CONST.DOCUMENT_PERMISSION_LEVELS.OWNER;
						playlist.update({permission: perms});
					});
					return;
				}
				
				if(!Settings.can_control(msg.src)) return "You do not have permission to control playback!";
				let playlist = game.playlists.get(msg.data.target);
				if(!playlist) return "Internal error: Cannot find playlist!";
				if(!Settings.can_control(msg.src, playlist)) return "You do not have permission to control this playlist!";
				
				if(msg.data.data?.ownership && playlist.description != msg.src) 
					return "You do not have permission to update ownership on this playlist.";
				
				switch (msg.action) {
					case "playlist-update":
						playlist.update(msg.data.data, msg.data.context);
						break;
					case "playlist-delete":
						if(playlist.description != msg.src) return "You cannot delete playlists you did not create!";
						playlist.delete(msg.data.context);
						break;
					default:
				}

			}
		});

		
		SocketHandler.registerHandler({
			actions: ["sound-update"],
			gm: true,
			func: (msg) => {
				if(!Settings.can_control(msg.src)) return "You do not have permission to control playback!";
				let playlist = game.playlists.get(msg.data.playlist);
				if(!playlist) return "Cannot find playlist!";
				if(!Settings.can_control(msg.src, playlist)) return "You do not have permission to control sounds from this playlist!";
				let sound = playlist.sounds.get(msg.data.target)
				if(!sound) return "Cannot find sound!"
				
				sound.update(msg.data.data, msg.data.context);
			}
		});
		
		//Register socket callback
		game.socket.on('module.music-permissions', function(msg, src){
			msg.src = src;
			SocketHandler.handleSocketEvent(msg);
		});
	}
}

export default SocketHandler
