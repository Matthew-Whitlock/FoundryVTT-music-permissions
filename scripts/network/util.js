export async function remoteGMAction(msg){
	let worker = null;
	
	game.users.find( (user) => {
		if(user.isGM && user.active){
			worker = user.id
			return true
		}
		return false
	});
	
	if(worker == null){
		let err = new Error("A Game Master must be active for this action, sorry!");
		ui.notifications.error(err);
		throw err;
		return;
	}
	
	msg.worker = worker;
	
	game.socket.emit("module.music-permissions", msg);
}

export async function remoteAction(action, workerIds, data){
	let msg = {data:data, action: action, worker: workerIds};
	
	if(msg.worker == "GM") return remoteGMAction(msg);
	
	game.socket.emit("module.music-permissions", msg)
}

export default remoteAction