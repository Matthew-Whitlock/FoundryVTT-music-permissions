import {remoteAction} from "../network/util.js"

class RemoteFolderConfig extends DocumentSheet {	

  constructor(object = {}, options = {}){
	options.editable = true;
    super(object, options)
	this.options.viewPermission = "NONE"
	this.options.editable = true;
  }
  
  get isEditable() {
	  return true;
  }
  
	  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sheet", "folder-edit"],
      template: "templates/sidebar/folder-edit.html",
	  width: 360
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get id() {
    return this.object.id ? `folder-edit-${this.object.id}` : "folder-create";
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    if ( this.object.id ) return `${game.i18n.localize("FOLDER.Update")}: ${this.object.name}`;
    return game.i18n.localize("FOLDER.Create");
  }

  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    return {
      name: this.object.id ? this.object.name : "",
      newName: game.i18n.format("DOCUMENT.New", {type: game.i18n.localize(Folder.metadata.label)}),
      folder: this.object.data,
      safeColor: this.object.data.color ?? "#000000",
      sortingModes: {"a": "FOLDER.SortAlphabetical", "m": "FOLDER.SortManual"},
      submitText: game.i18n.localize(this.object.id ? "FOLDER.Update" : "FOLDER.Create")
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    if ( !formData.parent ) formData.parent = null;
    if ( !this.object.id ) {
      this.object.data.update(formData);
	  //Folder.create(this.object.data);
	  remoteAction("folder-create", "GM", {data:this.object.data});
      return true;
    }
	//console.log("Sending edit request!");
	//console.log(this.object)
    remoteAction("folder-edit", "GM", {
		target: this.object.id,
		data: formData
	});
	//return this.object.update(formData);
	return true;
  }
}

export default RemoteFolderConfig