class Globals {
	static local = {
		//userId -> playlistId -> soundId -> 
		//{playing: , paused: , callbackIds: map callback name -> callbackId, soundSrc: , global:{paused:, playing:}}
		_user_locals_known: new Map(),
	
		//Promise w/ a short delay before running a render of the playlist dir, 
		//to catch when a bunch of updates come in quickly.
		_handling_updates: null,
		
		//Fill with {playlistId, userId} for requested playlist and requesting 
		//userId of remote commands we should actually listen to.
		_force_next_reqs: [],
		
		_sounds_to_stop: [],
		
		_handling_real_updates: true,
		_render_on_local_updates: true,
		_caught_interleaving: false,
		
		_doing_local_update: false,
		
		//{id, actions}
		_socket_handlers: [],
		_event_handlers: []
	}
}

export default Globals