class Settings {
	static init(){
		game.settings.register("music-permissions", "playback-perm",{
			name: "Playback: ",
			hint: "Users of this role and up will be able to start/stop songs in any playlists have permissions in.",
			scope: "world",
			config: true,
			type: Number,
			choices: {
				1: "All players",
				2: "Trusted players",
				3: "Assistant GMs"
			},
			default: 3,
			onChange: value => {
				ui["playlists"].render(true);
			}
		});

		game.settings.register("music-permissions", "edit-perm",{
			name: "Edit: ",
			hint: "Users of this role and above will be able to configure playlists and folders they have permissions for, including uploading, adding, and removing songs.",
			scope: "world",
			config: true,
			type: Number,
			choices: {
				1: "All players",
				2: "Trusted players",
				3: "Assistant GMs"
			},
			default: 3,
			onChange: value => {
				ui["playlists"].render(true);
			}
		});
		
		//Will be used if I set up a ui interface to the 
		game.settings.register("music-permissions", "min-locals-role",{
			name: "Minimum local-playback permissions:",
			hint: "What role is needed to allow a user to control people's local playback settings?",
			scope: "world",
			config: true,
			type: Number,
			choices: {
				1: "All players",
				2: "Trusted players",
				3: "Assistant GMs",
				4: "GM",
				5: "Disabled"
			},
			default: 5
		});
		
		game.settings.register("music-permissions", "min-control-perm",{
			name: "Minimum control permission:",
			hint: "What ownership level must a player have to play from a playlist?",
			scope: "world",
			config: true,
			type: Number,
			choices: {
				1: "Limited",
				2: "Observer",
				3: "Owner"
			},
			default: 2,
			onChange: value => {
				ui["playlists"].render(true);
			}
		});
		
		game.settings.register("music-permissions", "limited-vision",{
			name: "Limited viewers can see songs?: ",
			hint: "Can people assigned limited permissions to a playlist see the names of the songs inside?",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
			onChange: value => {
				ui["playlists"].render(true);
			}
		});

		//Wrapped into edit permissions now, keeping for posterity or something.
		/*game.settings.register("music-permissions", "create-perm",{
			name: "Create playlists:",
			hint: "Warning, enabling this setting requires editing server files. See GitHub for info.",
			scope: "world",
			config: true,
			type: Number,
			choices: {
				1: "All players",
				2: "Trusted players",
				3: "Assistant GMs"
			},
			default: "3",
			onChange: value => {
				ui["playlists"].render(true);
			}
		});*/
	}
	
	static limited_vision(){
		return game.settings.get("music-permissions", "limited-vision");
	}
	
	static min_control_perm(){
		return game.settings.get("music-permissions", "min-control-perm");
	}
	
	static min_locals_role(){
		return game.settings.get("music-permissions", "min-locals-role");
	}
	
	static playback_perm(){
		return game.settings.get("music-permissions", "playback-perm");
	}
	
	static edit_perm(){
		return game.settings.get("music-permissions", "edit-perm");
	}
	
	static can_edit(userId=game.userId, obj = null){
		let user = game.users.get(userId)
		
		if(user.role < Settings.edit_perm()) return false;
		else if(!obj) return true; //generically ask if user has edit permitted role.
		
		if(obj instanceof PlaylistSound){
			let playlist = obj.parent
			return playlist.getUserLevel(user) == CONST.DOCUMENT_PERMISSION_LEVELS.OWNER
		}
		if(obj instanceof Playlist){
			return obj.getUserLevel(user) == CONST.DOCUMENT_PERMISSION_LEVELS.OWNER
		}
		if(obj instanceof Folder){
			return folder.data.description == game.userId || game.users.get(userId).isGM
		}
		
		console.log("MusicPermissions: Error, trying to edit something other than PlaylistSound/Playlist/Folder? " + typeof obj);
		return false
	}
	
	static can_control(userId=game.userId, obj = null){
		let user = game.users.get(userId)
		
		if(user.role < Settings.playback_perm()) return false;
		else if(!obj) return true; //generically ask if user has control permitted role.
		

		if(obj instanceof PlaylistSound){
			return obj.parent.getUserLevel(user) >= Settings.min_control_perm()
		}
		if(obj instanceof Playlist){
			return obj.getUserLevel(user) >= Settings.min_control_perm()
		}

		console.log("MusicPermissions: Error, trying to control something other than PlaylistSound/Playlist? " + typeof obj);
		return false
	}
	
	static can_create(userId=game.userId, obj = null){
		return game.users.get(userId).role >= Settings.edit_perm() //No special permission for this for now.
	}
	
	static can_view(sound){
		return sound.parent.permission > 1 || (Settings.limited_vision() && sound.parent.permission > 0)
	}
	
	static can_local_control(userId = game.userId){
		return Settings.min_locals_role() <= game.users.get(userId).role
	}
}

export default Settings