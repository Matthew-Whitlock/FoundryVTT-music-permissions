async function sendRemoteRequest(data){
	let worker = null;
	
	game.users.forEach( (user) => {
		if(user.isGM && user.active && worker == null) worker = user.id
	});
	
	if(worker == null){
		let err = new Error("A Game Master must be active for this action, sorry!");
		ui.notifications.error(err);
		throw err;
		return;
	}
	
	data.worker = worker;
	await new Promise((resolve, reject) => {
		game.socket.emit("module.music-permissions", data);
		return resolve();
	})
}

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
	  sendRemoteRequest({
		 action: "folder-create",
		 data: this.object.data
	  });
      return true;
    }
	//console.log("Sending edit request!");
	//console.log(this.object)
    sendRemoteRequest({
		action: "folder-edit",
		target: this.object.id,
		data: formData
	});
	//return this.object.update(formData);
	return true;
  }
}

class CustSidebarDirectory extends SidebarTab {
  constructor(options) {
    super(options);

    /**
     * References to the set of Documents which are displayed in the Sidebar
     * @type {Document[]}
     */
    this.documents = null;

    /**
     * Reference the set of Folders which exist in this Sidebar
     * @type {Folder[]}
     */
    this.folders = null;

    // Initialize sidebar content
    this.initialize();

    // Record the directory as an application of the collection if it is not a popout
    if ( !this.options.popOut ) this.constructor.collection.apps.push(this);
  }
  
  static haveControlPerms(userId = game.userId){
	let user = game.users.get(userId);
    return user.role >= game.settings.get("music-permissions", "playback-perm");
  }
  
  static haveEditPerms(userId = game.userId){
	let user = game.users.get(userId);
	return user.role >= game.settings.get("music-permissions", "edit-perm");
  }
  
  static haveCreatePerms(userId = game.userId){
	return CustSidebarDirectory.haveEditPerms(userId);
	//let user = game.users.get(userId);
	//return user.role >= game.settings.get("music-permissions", "create-perm");
  }
  
  

	/* -------------------------------------------- */

  /**
   * A reference to the named Document type that this Sidebar Directory instance displays
   * @type {string}
   */
  static documentName = "Document";

  /**
   * The path to the template partial which renders a single Document within this directory
   * @type {string}
   */
  static documentPartial = "templates/sidebar/document-partial.html";

  /**
   * The path to the template partial which renders a single Folder within this directory
   * @type {string}
   */
  static folderPartial = "templates/sidebar/folder-partial.html";

	/* -------------------------------------------- */

  /**
   * @override
   * @returns {SidebarDirectoryOptions}
   */
	static get defaultOptions() {
	  const cls = getDocumentClass(this.documentName);
	  const collection = cls.metadata.collection;
	  return foundry.utils.mergeObject(super.defaultOptions, {
      id: collection,
      template: "templates/sidebar/document-directory.html",
      title: `${game.i18n.localize(cls.metadata.labelPlural)} Directory`,
      renderUpdateKeys: ["name", "img", "thumb", "permission", "sort", "sorting", "folder"],
      height: "auto",
      scrollY: ["ol.directory-list"],
      dragDrop: [{ dragSelector: ".directory-item",  dropSelector: ".directory-list"}],
      filters: [{inputSelector: 'input[name="search"]', contentSelector: ".directory-list"}],
      contextMenuSelector: ".document"
    });
  }

	/* -------------------------------------------- */

  /**
   * The WorldCollection instance which this Sidebar Directory displays.
   * @type {WorldCollection}
   */
  static get collection() {
    return game.collections.get(this.documentName);
  }

	/* -------------------------------------------- */
  /*  Initialization Helpers
	/* -------------------------------------------- */

  /**
   * Initialize the content of the directory by categorizing folders and documents into a hierarchical tree structure.
   */
  initialize() {

    // Assign Folders
    this.folders = game.folders.filter(f => f.type === this.constructor.documentName);

    // Assign Documents
    this.documents = this.constructor.collection.filter(e => true);

    // Build Tree
    this.tree = this.constructor.setupFolders(this.folders, this.documents);
  }

	/* -------------------------------------------- */

  /**
   * Given a Document type and a list of Document instances, set up the Folder tree
   * @param {Folder[]} folders        The Array of Folder objects to organize
   * @param {Document[]} documents    The Array of Document objects to organize
   * @return {Object}                 A tree structure containing the folders and documents
   */
  static setupFolders(folders, documents) {
    documents = documents.filter(d => d.permission > 0);
    const depths = [];
    const handled = new Set();

    // Iterate parent levels
    const root = {id: null};
    let batch = [root];
    for ( let i = 0; i < CONST.FOLDER_MAX_DEPTH; i++ ) {
      depths[i] = [];
      for ( let folder of batch ) {
        if ( handled.has(folder.id) ) continue;

        // Classify content for this folder
        try {
          [folders, documents] = this._populate(folder, folders, documents);
        } catch(err) {
          Hooks.onError("SidebarDirectory.setupFolders", err, {log: "error"});
          continue;
        }

        // Add child folders to the correct depth level
        depths[i] = depths[i].concat(folder.children);
        folder.depth = i;
        handled.add(folder.id);
      }
      batch = depths[i];
    }

    // Populate content to any remaining folders and assign them to the root level
    const remaining = depths[CONST.FOLDER_MAX_DEPTH-1].concat(folders);
    for ( let f of remaining ) {
      [folders, documents] = this._populate(f, folders, documents, {allowChildren: false});
    }
    depths[0] = depths[0].concat(folders);

    // Filter folder visibility
    for ( let i = CONST.FOLDER_MAX_DEPTH - 1; i >= 0; i-- ) {
      depths[i] = depths[i].reduce((arr, f) => {
        f.children = f.children.filter(c => {
			return c.displayed || c.data?.description == game.userId
		});
        if ( !f.displayed && f.data.description != game.userId) return arr;
        f.depth = i+1;
        arr.push(f);
        return arr;
      }, []);
    }

    // Return the root level contents of folders and documents
    return {
      root: true,
      content: root.content.concat(documents),
      children: depths[0]
    };
  }

  /* -------------------------------------------- */

  /**
   * Populate a single folder with child folders and content
   * This method is called recursively when building the folder tree
   * @private
   */
  static _populate(folder, folders, documents, {allowChildren=true}={}) {
    const id = folder.id;

    // Define sorting function for this folder
    const alpha = folder.data?.sorting === "a";
    const s = alpha ? this._sortAlphabetical : (a, b) => a.data.sort - b.data.sort;

    // Partition folders into children and unassigned folders
    let [u, children] = folders.partition(f => allowChildren && (f.data.parent === id));
    folder.children = children.sort(s);
    folders = u;

    // Partition documents into contents and unassigned documents
    const [docs, content] = documents.partition(e => e.data.folder === id);
    folder.content = content.sort(s);
    documents = docs;

    // Return the remainder
    return [folders, documents];
  }

  /* -------------------------------------------- */

  /**
   * Sort two Documents by name, alphabetically.
   * @param {Document} a
   * @param {Document} b
   * @return {number}    A value > 0 if b should be sorted before a.
   *                     A value < 0 if a should be sorted before b.
   *                     0 if the position of a and b should not change.
   * @private
   */
  static _sortAlphabetical(a, b) {
    return a.name.localeCompare(b.name);
  }

  /* -------------------------------------------- */
  /*  Application Rendering
  /* -------------------------------------------- */

  /** @inheritdoc */
	async _render(force, context={}) {

    // Only re-render the sidebar directory for certain types of updates
    const {action, data, documentType} = context;
    if ( action && !["create", "update", "delete"].includes(action) ) return this;
    if ( (documentType !== "Folder") && (action === "update") && !data.some(d => {
      return this.options.renderUpdateKeys.some(k => k in d);
    }) ) return;

    // Re-build the tree and render
    this.initialize();
    return super._render(force, context);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    const cfg = CONFIG[this.constructor.documentName];
    const cls = cfg.documentClass;
    return {
      user: game.user,
      tree: this.tree,
      canCreate: CustSidebarDirectory.haveCreatePerms(),
      documentCls: cls.documentName.toLowerCase(),
      tabName: cls.metadata.collection,
      sidebarIcon: cfg.sidebarIcon,
      label: game.i18n.localize(cls.metadata.label),
      labelPlural: game.i18n.localize(cls.metadata.labelPlural),
      documentPartial: this.constructor.documentPartial,
      folderPartial: this.constructor.folderPartial
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _renderInner(data) {
    await loadTemplates([data.documentPartial, data.folderPartial]);
    return super._renderInner(data);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onSearchFilter(event, query, rgx, html) {
    const isSearch = !!query;
    let documentIds = new Set();
    let folderIds = new Set();

    // Match documents and folders
    if ( isSearch ) {

      // Match document names
      for ( let d of this.documents ) {
        if ( rgx.test(SearchFilter.cleanQuery(d.name)) ) {
          documentIds.add(d.id);
          if ( d.data.folder ) folderIds.add(d.data.folder);
        }
      }

      // Match folder tree
      const includeFolders = fids => {
        const folders = this.folders.filter(f => fids.has(f.id));
        const pids = new Set(folders.filter(f => f.data.parent).map(f => f.data.parent));
        if ( pids.size ) {
          pids.forEach(p => folderIds.add(p));
          includeFolders(pids);
        }
      };
      includeFolders(folderIds);
    }

    // Toggle each directory item
    for ( let el of html.querySelectorAll(".directory-item") ) {

      // Documents
      if (el.classList.contains("document")) {
        el.style.display = (!isSearch || documentIds.has(el.dataset.documentId)) ? "flex" : "none";
      }

      // Folders
      if (el.classList.contains("folder")) {
        let match = isSearch && folderIds.has(el.dataset.folderId);
        el.style.display = (!isSearch || match) ? "flex" : "none";
        if (isSearch && match) el.classList.remove("collapsed");
        else el.classList.toggle("collapsed", !game.folders._expanded[el.dataset.folderId]);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Collapse all subfolders in this directory
   */
  collapseAll() {
    this.element.find('li.folder').addClass("collapsed");
    for ( let f of this.folders ) {
      game.folders._expanded[f.id] = false;
    }
    if ( this.popOut ) this.setPosition();
  }

	/* -------------------------------------------- */
	/*  Event Listeners and Handlers                */
	/* -------------------------------------------- */

  /**
   * Activate event listeners triggered within the Actor Directory HTML
   */
	activateListeners(html) {
	  super.activateListeners(html);
    const directory = html.find(".directory-list");
    const entries = directory.find(".directory-item");

    // Directory-level events
    html.find('.create-document').click(ev => this._onCreateDocument(ev));
    html.find('.collapse-all').click(this.collapseAll.bind(this));
    html.find(".folder .folder .folder .create-folder").remove(); // Prevent excessive folder nesting
    if ( CustSidebarDirectory.haveCreatePerms() ) html.find('.create-folder').click(ev => this._onCreateFolder(ev));

	  // Entry-level events
    directory.on("click", ".document-name", this._onClickDocumentName.bind(this));
    directory.on("click", ".folder-header", this._toggleFolder.bind(this));
    const dh = this._onDragHighlight.bind(this);
    html.find(".folder").on("dragenter", dh).on("dragleave", dh);
    this._contextMenu(html);

    // Intersection Observer
    const observer = new IntersectionObserver(this._onLazyLoadImage.bind(this), { root: directory[0] });
    entries.each((i, li) => observer.observe(li));
  }

  /* -------------------------------------------- */

  /**
   * Handle clicking on a Document name in the Sidebar directory
   * @param {Event} event   The originating click event
   * @protected
   */
  _onClickDocumentName(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const documentId = element.parentElement.dataset.documentId;
    const document = this.constructor.collection.get(documentId);
    const sheet = document.sheet;

    // If the sheet is already rendered:
    if ( sheet.rendered ) {
      sheet.bringToTop();
      return sheet.maximize();
    }

    // Otherwise render the sheet
    else sheet.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle new Document creation request
   * @param {MouseEvent} event    The originating button click event
   * @protected
   */
  async _onCreateDocument(event) {
    event.preventDefault();
    event.stopPropagation();
	
    const button = event.currentTarget;
    const data = {folder: button.dataset.folder};
    const options = {width: 320, left: window.innerWidth - 630, top: button.offsetTop };
    //return Playlist.createDialog(data, options);
	
	const documentName = "Playlist";
    const types = game.system.documentTypes[documentName];
    const folders = game.folders.filter(f => (f.data.type === documentName) && f.displayed);
    const label = game.i18n.localize(Playlist.metadata.label);
    const title = game.i18n.format("DOCUMENT.Create", {type: label});

    // Render the document creation form
    const html = await renderTemplate(`templates/sidebar/document-create.html`, {
      name: data.name || game.i18n.format("DOCUMENT.New", {type: label}),
      folder: data.folder,
      folders: folders,
      hasFolders: folders.length >= 1,
      type: data.type || types[0],
      types: types.reduce((obj, t) => {
        const label = CONFIG[documentName]?.typeLabels?.[t] ?? t;
        obj[t] = game.i18n.has(label) ? game.i18n.localize(label) : t;
        return obj;
      }, {}),
      hasTypes: types.length > 1
    });

    // Render the confirmation dialog window
    return Dialog.prompt({
      title: title,
      content: html,
      label: title,
      callback: html => {
        const form = html[0].querySelector("form");
        const fd = new FormDataExtended(form);
        foundry.utils.mergeObject(data, fd.toObject(), {inplace: true});
        if ( !data.folder ) delete data["folder"];
        if ( types.length === 1 ) data.type = types[0];
		
		if(game.user.isGM) return Playlist.create(data, {renderSheet: true});
		else return sendRemoteRequest({"action": "playlist-create", "data": data});
      },
      rejectClose: false,
      options: options
    });
  }

	/* -------------------------------------------- */

  /**
   * Create a new Folder in this SidebarDirectory
   * @param {MouseEvent} event    The originating button click event
   * @protected
   */
	_onCreateFolder(event) {
	  event.preventDefault();
	  event.stopPropagation();
	  const button = event.currentTarget;
    const parent = button.dataset.parentFolder;
    const data = {parent: parent ? parent : null, type: this.constructor.documentName};
	
	const options = {
		top: button.offsetTop, 
		left: window.innerWidth - 310 - FolderConfig.defaultOptions.width,
	};
	  
	  
	  
	  if(game.user.isGM){
		Folder.createDialog(data, options);
	  } else {
		const label = game.i18n.localize(Folder.metadata.label);
		const folderData = foundry.utils.mergeObject({
		  name: game.i18n.format("DOCUMENT.New", {type: label}),
		  sorting: "a",
		}, data);
		const folder = new Folder(folderData);
		folder.data.permission = {};
		folder.data.permission[game.userId] = CONST.DOCUMENT_PERMISSION_LEVELS.OWNER;
		return new RemoteFolderConfig(folder, options).render(true);
	  }
	  
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the collapsed or expanded state of a folder within the directory tab
   * @param {MouseEvent} event    The originating click event
   * @protected
   */
  _toggleFolder(event) {
    let folder = $(event.currentTarget.parentElement);
    let collapsed = folder.hasClass("collapsed");
    game.folders._expanded[folder.attr("data-folder-id")] = collapsed;

    // Expand
    if ( collapsed ) folder.removeClass("collapsed");

    // Collapse
    else {
      folder.addClass("collapsed");
      const subs = folder.find('.folder').addClass("collapsed");
      subs.each((i, f) => game.folders._expanded[f.dataset.folderId] = false);
    }

    // Resize container
    if ( this.popOut ) this.setPosition();
  }

	/* -------------------------------------------- */

  /** @override */
  _onDragStart(event) {
    if ( ui.context ) ui.context.close({animate: false});
    let li = event.currentTarget.closest(".directory-item");
    const isFolder = li.classList.contains("folder");
    const dragData = isFolder ?
      { type: "Folder", id: li.dataset.folderId, documentName: this.constructor.documentName } :
      { type: this.constructor.documentName, id: li.dataset.documentId };
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    this._dragType = dragData.type;
  }

  /* -------------------------------------------- */

  /** @override */
  _canDragStart(selector) {
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Highlight folders as drop targets when a drag event enters or exits their area
   * @param {DragEvent} event     The DragEvent which is in progress
   */
  _onDragHighlight(event) {
    const li = event.currentTarget;
    if ( !li.classList.contains("folder") ) return;
    event.stopPropagation();  // Don't bubble to parent folders

    // Remove existing drop targets
    if ( event.type === "dragenter" ) {
      for ( let t of li.closest(".directory-list").querySelectorAll(".droptarget") ) {
        t.classList.remove("droptarget");
      }
    }

    // Remove current drop target
    if ( event.type === "dragleave" ) {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const parent = el.closest(".folder");
      if ( parent === li ) return;
    }

    // Add new drop target
    li.classList.toggle("droptarget", event.type === "dragenter");
  }

  /* -------------------------------------------- */

  /** @override */
  _onDrop(event) {
    const cls = this.constructor.documentName;

    // Try to extract the data
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    }
    catch (err) {
      return false;
    }

    // Identify the drop target
    const selector = this._dragDrop[0].dropSelector;
    const target = event.target.closest(".directory-item") || null;

    // Call the drop handler
    switch ( data.type ) {
      case "Folder":
        return this._handleDroppedFolder(target, data);
      case cls:
        return this._handleDroppedDocument(target, data);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle Document data being dropped into the directory.
   * @param {HTMLElement} target    The target element
   * @param {Object} data           The data being dropped
   * @protected
   */
  async _handleDroppedDocument(target, data) {
	
    // Determine the closest folder ID
    const closestFolder = target ? target.closest(".folder") : null;
    if ( closestFolder ) closestFolder.classList.remove("droptarget");
    const closestFolderId = closestFolder ? closestFolder.dataset.folderId : null;

    // Obtain the dropped document
	  const cls = getDocumentClass(this.constructor.documentName);
    const collection = this.constructor.collection;
    const document = await cls.fromDropData(data, {importWorld: true});
    if ( !document ) return;

    // Sort relative to another Document
    const sortData = {sortKey: "sort", sortBefore: true};
    const isRelative = target && target.dataset.documentId;
    if ( isRelative ) {
      if ( document.id === target.dataset.documentId ) return; // Don't drop on yourself
      const targetDocument = collection.get(target.dataset.documentId);
      sortData.target = targetDocument;
      sortData.folderId = targetDocument.data.folder;
    }

    // Sort relative to the closest Folder
    else {
      sortData.target = null;
      sortData.folderId = closestFolderId;
    }

    // Determine siblings and perform sort
    sortData.siblings = collection.filter(doc => {
      return (doc.data.folder === sortData.folderId) && (doc.id !== data.id);
    });
    sortData.updateData = { folder: sortData.folderId };
    return document.sortRelative(sortData);
  }

  /* -------------------------------------------- */

  /**
   * Handle Folder data being dropped into the directory.
   * @param {HTMLElement} target    The target element
   * @param {Object} data           The data being dropped
   * @protected
   */
  async _handleDroppedFolder(target, data) {
    if ( data.documentName !== this.constructor.documentName ) return;
    const folder = await Folder.implementation.fromDropData(data);

    // Determine the closest folder ID
    const closestFolder = target ? target.closest(".folder") : null;
    if ( closestFolder ) closestFolder.classList.remove("droptarget");
    const closestFolderId = closestFolder ? closestFolder.dataset.folderId : null;

    // Sort into another Folder
    const sortData = {sortKey: "sort", sortBefore: true};
    const isFolder = target && target.dataset.folderId;
    if ( isFolder ) {
      const targetFolder = game.folders.get(target.dataset.folderId);
      if ( folder.id === targetFolder.id ) return; // Don't drop on yourself

      // Sort relative to a collapsed Folder
      if ( target.classList.contains("collapsed") ) {
        sortData.target = targetFolder;
        sortData.parentId = targetFolder.data.parent;
      }

      // Drop into an expanded Folder
      else {
        if (Number(target.dataset.folderDepth) >= CONST.FOLDER_MAX_DEPTH) return; // Prevent going beyond max depth
        sortData.target = null;
        sortData.parentId = targetFolder.id;
      }
    }

    // Sort relative to existing Folder contents
    else {
      sortData.parentId = closestFolderId;
      sortData.target = closestFolder && closestFolder.classList.contains("collapsed") ? closestFolder : null;
    }

    // Determine siblings and perform sort
    sortData.siblings = game.folders.filter(f => {
      return (f.data.parent === sortData.parentId) && (f.data.type === folder.data.type) && (f !== folder);
    });
    sortData.updateData = { parent: sortData.parentId };
    return folder.sortRelative(sortData);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _contextMenu(html) {
    /**
     * A hook event that fires when the context menu for folders in a SidebarTab is constructed. Substitute the
     * SidebarTab name in the hook event to target a specific SidebarTab, for example "getActorDirectoryFolderContext".
     * @function getSidebarTabFolderContext
     * @memberof hookEvents
     * @param {jQuery} html                     The HTML element to which the context options are attached
     * @param {ContextMenuEntry[]} entryOptions The context menu entries
     */
    ContextMenu.create(this, html, ".folder .folder-header", this._getFolderContextOptions(), "FolderContext");
    ContextMenu.create(this, html, this.options.contextMenuSelector, this._getEntryContextOptions());
  }

  /* -------------------------------------------- */

  /**
   * Get the set of ContextMenu options which should be used for Folders in a SidebarDirectory
   * @return {object[]}   The Array of context options passed to the ContextMenu instance
   * @protected
   */
  _getFolderContextOptions() {
    return [
      {
        name: "FOLDER.Edit",
        icon: '<i class="fas fa-edit"></i>',
        condition: (header) => {
			const folder = game.folders.get(header.parent().data("folderId"))
			return CustSidebarDirectory.haveEditPerms() && (game.user.isGM || folder.data.description == game.userId)
		},
        callback: header => {
          const li = header.parent()[0];
          const folder = game.folders.get(li.dataset.folderId);
          const options = {top: li.offsetTop, left: window.innerWidth - 310 - FolderConfig.defaultOptions.width};
          if(game.user.isGM){
			  new FolderConfig(folder, options).render(true);
		  } else {
			  new RemoteFolderConfig(folder, options).render(true);
		  }
        }
      },
      {
        name: "PERMISSION.Configure",
        icon: '<i class="fas fa-lock"></i>',
        condition: () => game.user.isGM,
        callback: header => {
          const li = header.parent()[0];
          const folder = game.folders.get(li.dataset.folderId);
          new PermissionControl(folder, {
            top: Math.min(li.offsetTop, window.innerHeight - 350),
            left: window.innerWidth - 720
          }).render(true);
        }
      },
      {
        name: "FOLDER.Export",
        icon: `<i class="fas fa-atlas"></i>`,
        condition: header => {
          const folder = game.folders.get(header.parent().data("folderId"));
          return CONST.COMPENDIUM_DOCUMENT_TYPES.includes(folder.type);
        },
        callback: header => {
          const li = header.parent();
          const folder = game.folders.get(li.data("folderId"));
          return folder.exportDialog(null, {
              top: Math.min(li[0].offsetTop, window.innerHeight - 350),
              left: window.innerWidth - 720,
              width: 400
          });
        }
      },
      {
        name: "FOLDER.CreateTable",
        icon: `<i class="${CONFIG.RollTable.sidebarIcon}"></i>`,
        condition: header => {
          const folder = game.folders.get(header.parent().data("folderId"));
          return CONST.COMPENDIUM_DOCUMENT_TYPES.includes(folder.type);
        },
        callback: header => {
          const li = header.parent()[0];
          const folder = game.folders.get(li.dataset.folderId);
          return Dialog.confirm({
            title: `${game.i18n.localize("FOLDER.CreateTable")}: ${folder.name}`,
            content: game.i18n.localize("FOLDER.CreateTableConfirm"),
            yes: () => RollTable.fromFolder(folder),
            options: {
              top: Math.min(li.offsetTop, window.innerHeight - 350),
              left: window.innerWidth - 680,
              width: 360
            }
          });
        }
      },
      {
        name: "FOLDER.Remove",
        icon: '<i class="fas fa-trash"></i>',
        condition:  (header) => {
			const folder = game.folders.get(header.parent().data("folderId"))
			return CustSidebarDirectory.haveEditPerms() && (game.user.isGM || folder.data.description == game.userId)
		},
        callback: header => {
          const li = header.parent();
          const folder = game.folders.get(li.data("folderId"));
          return Dialog.confirm({
            title: `${game.i18n.localize("FOLDER.Remove")} ${folder.name}`,
            content: `<h4>${game.i18n.localize("AreYouSure")}</h4><p>${game.i18n.localize("FOLDER.RemoveWarning")}</p>`,
            yes: () => {
				if(game.user.isGM) folder.delete({deleteSubfolders: false, deleteContents: false})
				else sendRemoteRequest({"action":"folder-remove", "target":folder.id});
			},
            options: {
              top: Math.min(li[0].offsetTop, window.innerHeight - 350),
              left: window.innerWidth - 720,
              width: 400
            }
          });
        }
      },
      {
        name: "FOLDER.Delete",
        icon: '<i class="fas fa-dumpster"></i>',
        condition: (header) => {
			return game.user.isGM
		},
        callback: header => {
          const li = header.parent();
          const folder = game.folders.get(li.data("folderId"));
          return Dialog.confirm({
            title: `${game.i18n.localize("FOLDER.Delete")} ${folder.name}`,
            content: `<h4>${game.i18n.localize("AreYouSure")}</h4><p>${game.i18n.localize("FOLDER.DeleteWarning")}</p>`,
            yes: () => {
				folder.delete({deleteSubfolders: true, deleteContents: true})
			},
            options: {
              top: Math.min(li[0].offsetTop, window.innerHeight - 350),
              left: window.innerWidth - 720,
              width: 400
            }
          });
        }
      }
    ];
  }

  /* -------------------------------------------- */

  /**
   * Get the set of ContextMenu options which should be used for Documents in a SidebarDirectory
   * @return {object[]}   The Array of context options passed to the ContextMenu instance
   * @protected
   */
  _getEntryContextOptions() {
    return [
      {
        name: "PERMISSION.Configure",
        icon: '<i class="fas fa-lock"></i>',
        condition: () => game.user.isGM,
        callback: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          new PermissionControl(document, {
            top: Math.min(li[0].offsetTop, window.innerHeight - 350),
            left: window.innerWidth - 720
          }).render(true);
        }
      },
	  {
        name: "FOLDER.Clear",
        icon: '<i class="fas fa-folder"></i>',
        condition: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          return game.user.isGM && !!document.data.folder;
        },
        callback: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          document.update({folder: null});
        }
      },
      {
        name: "SIDEBAR.Delete",
        icon: '<i class="fas fa-trash"></i>',
        condition: (li) => {
			const document = this.constructor.collection.get(li.data("documentId"))
			return document && document.permission > 2 && CustSidebarDirectory.haveEditPerms()
		},
        callback: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          if ( !document ) return;
          return document.deleteDialog({
            top: Math.min(li[0].offsetTop, window.innerHeight - 350),
            left: window.innerWidth - 720
          });
        }
      },
      {
        name: "SIDEBAR.Duplicate",
        icon: '<i class="far fa-copy"></i>',
        condition: () => CustSidebarDirectory.haveCreatePerms(),
        callback: li => {
          const original = this.constructor.collection.get(li.data("documentId"));
          return original.clone({name: `${original.name} (Copy)`}, {save: true});
        }
      },
      {
        name: "SIDEBAR.Export",
        icon: '<i class="fas fa-file-export"></i>',
        condition: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          return document.permission > 1;
        },
        callback: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          return document.exportToJSON();
        }
      },
      {
        name: "SIDEBAR.Import",
        icon: '<i class="fas fa-file-import"></i>',
        condition: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          return document.isOwner && CustSidebarDirectory.haveEditPerms();
        },
        callback: li => {
          const document = this.constructor.collection.get(li.data("documentId"));
          return document.importFromJSONDialog();
        }
      }
    ];
  }
}


class CustPlaylistDirectory extends CustSidebarDirectory {
  constructor(options) {
    super(options);

    /**
     * Track the playlist IDs which are currently expanded in their display
     * @type {Set<string>}
     */
    this._expanded = this._createExpandedSet();

    /**
     * Are the global volume controls currently expanded?
     * @type {boolean}
     * @private
     */
    this._volumeExpanded = false;

    /**
     * Cache the set of Playlist documents that are displayed as playing when the directory is rendered
     * @type {Playlist[]}
     */
    this._playingPlaylists = [];

    /**
     * Cache the set of PlaylistSound documents that are displayed as playing when the directory is rendered
     * @type {PlaylistSound[]}
     */
    this._playingSounds = [];

    // Update timestamps every second
    setInterval(this._updateTimestamps.bind(this), 1000);

    // Playlist 'currently playing' pinned location.
    game.settings.register("core", "playlist.playingLocation", {
      scope: "client",
      config: false,
      default: "top",
      type: String,
      onChange: () => ui.playlists.render()
    });
  }

  /** @override */
  static documentName = "Playlist";

  /** @override */
  static documentPartial = "templates/sidebar/playlist-partial.html";

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.template = "templates/sidebar/playlists-directory.html";
    options.dragDrop[0].dragSelector = ".playlist-name, .sound-name";
    options.renderUpdateKeys = ["name", "playing", "mode", "sounds", "sort", "sorting", "folder"];
    options.contextMenuSelector = ".document .playlist-header";
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Initialize the set of Playlists which should be displayed in an expanded form
   * @returns {Set<string>}
   * @private
   */
  _createExpandedSet() {
    const expanded = new Set();
    for ( let playlist of this.documents ) {
      if ( playlist.playing ) expanded.add(playlist.id);
    }
    return expanded;
  }

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * Return an Array of the Playlist documents which are currently playing
   * @type {Playlist[]}
   */
  get playing() {
    return this._playingPlaylists;
  }

  /**
   * Whether the 'currently playing' element is pinned to the top or bottom of the display.
   * @type {string}
   * @private
   */
  get _playingLocation() {
    return game.settings.get("core", "playlist.playingLocation");
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    this._playingPlaylists = [];
    this._playingSounds = [];
    this._playingSoundsData = [];
    this._prepareTreeData(this.tree);
    const data = await super.getData(options);
    const currentAtTop = this._playingLocation === "top";
    return foundry.utils.mergeObject(data, {
      playingSounds: this._playingSoundsData,
      showPlaying: this._playingSoundsData.length > 0,
      playlistModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalPlaylistVolume")),
      ambientModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalAmbientVolume")),
      interfaceModifier: AudioHelper.volumeToInput(game.settings.get("core", "globalInterfaceVolume")),
      volumeExpanded: this._volumeExpanded,
      currentlyPlaying: {
        class: `location-${currentAtTop ? "top" : "bottom"}`,
        location: {top: currentAtTop, bottom: !currentAtTop},
        pin: {label: `PLAYLIST.PinTo${currentAtTop ? "Bottom" : "Top"}`, caret: currentAtTop ? "down" : "up"}
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Augment the tree directory structure with playlist-level data objects for rendering
   * @param {object} leaf   The tree leaf node being prepared
   * @private
   */
  _prepareTreeData(leaf) {
    leaf.content = leaf.content.map(p => this._preparePlaylistData(p));
    for ( let f of leaf.children ) {
      this._prepareTreeData(f);
    }
  }

  /* -------------------------------------------- */

  /**
   * Create an object of rendering data for each Playlist document being displayed
   * @param {Playlist} playlist   The playlist to display
   * @returns {object}            The data for rendering
   * @private
   */
  _preparePlaylistData(playlist) {
    if ( playlist.playing ) this._playingPlaylists.push(playlist);

	const min_control_perm = game.settings.get("music-permissions", "min-control-perm");
	
    // Playlist configuration
    const p = playlist.data.toObject(false);
    p.modeTooltip = this._getModeTooltip(p.mode);
    p.modeIcon = this._getModeIcon(p.mode);
    p.disabled = p.mode === CONST.PLAYLIST_MODES.DISABLED;
    p.expanded = this._expanded.has(p._id);
    p.css = [p.expanded ? "" : "collapsed", playlist.playing ? "playing" : ""].filterJoin(" ")
    p.controlCSS = (CustSidebarDirectory.haveControlPerms() && ((playlist.permission >= min_control_perm) && !p.disabled)) ? "" : "disabled";

    // Playlist sounds
    const sounds = [];
    for ( let sound of playlist.sounds ) {
      if ( !((playlist.permission > 0 && game.settings.get("music-permissions", "limited-vision")) || playlist.permission > 1) && (!sound.playing && !(sound.data.pausedTime && CustSidebarDirectory.haveControlPerms() && playlist.permission >= min_control_perm)) ){
		continue;
	  }

      // All sounds
      const s = sound.data.toObject(false);
      s.playlistId = playlist.id;
      s.css = s.playing ? "playing" : "";
      s.controlCSS = (CustSidebarDirectory.haveControlPerms() && playlist.permission >= min_control_perm) ? "" : "disabled";
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
    p.sounds = sounds.sort(playlist._sortSounds.bind(playlist));
    return p;
  }

  /* -------------------------------------------- */

  /**
   * Get the icon used to represent the "play/stop" icon for the PlaylistSound
   * @param {PlaylistSound} sound   The sound being rendered
   * @returns {string}              The icon that should be used
   * @private
   */
  _getPlayIcon(sound) {
    if ( !sound.playing ) return sound.data.pausedTime ? "fas fa-play-circle" : "fas fa-play";
    else return "fas fa-square";
  }

  /* -------------------------------------------- */

  /**
   * Get the icon used to represent the pause/loading icon for the PlaylistSound
   * @param {PlaylistSound} sound   The sound being rendered
   * @returns {string}              The icon that should be used
   * @private
   */
  _getPauseIcon(sound) {
    return (sound.playing && !sound.sound?.loaded) ? "fas fa-spinner fa-spin" : "fas fa-pause";
  }

  /* -------------------------------------------- */

  /**
   * Given a constant playback mode, provide the FontAwesome icon used to display it
   * @param {number} mode
   * @return {string}
   * @private
   */
  _getModeIcon(mode) {
    return {
      [CONST.PLAYLIST_MODES.DISABLED]: '<i class="fas fa-ban"></i>',
      [CONST.PLAYLIST_MODES.SEQUENTIAL]: '<i class="far fa-arrow-alt-circle-right"></i>',
      [CONST.PLAYLIST_MODES.SHUFFLE]: '<i class="fas fa-random"></i>',
      [CONST.PLAYLIST_MODES.SIMULTANEOUS]: '<i class="fas fa-compress-arrows-alt"></i>',
    }[mode];
  }

  /* -------------------------------------------- */

  /**
   * Given a constant playback mode, provide the string tooltip used to describe it
   * @param {number} mode
   * @return {string}
   * @private
   */
  _getModeTooltip(mode) {
    return {
      [CONST.PLAYLIST_MODES.DISABLED]: game.i18n.localize("PLAYLIST.ModeDisabled"),
      [CONST.PLAYLIST_MODES.SEQUENTIAL]: game.i18n.localize("PLAYLIST.ModeSequential"),
      [CONST.PLAYLIST_MODES.SHUFFLE]: game.i18n.localize("PLAYLIST.ModeShuffle"),
      [CONST.PLAYLIST_MODES.SIMULTANEOUS]: game.i18n.localize("PLAYLIST.ModeSimultaneous")
    }[mode];
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    if(!game.user.isGM){ //Already there for GMs
	  if(CustSidebarDirectory.haveControlPerms()){
		  html.find('.sound-controls').each(function(num, div){
			if(div.className.includes("playlist-controls")) return;
			const li = div.closest(".sound")
			const playlist = game.playlists.get(li.dataset.playlistId);
			const sound = playlist.sounds.get(li.dataset.soundId);
			
			div.innerHTML = `
					<a class="sound-control ` + (sound.data?.repeat ? " " : " inactive ") + ((playlist.permission > 2) ? "" : "disabled") + `"
						data-action="sound-repeat" title="` + game.i18n.localize('PLAYLIST.SoundLoop') + `">
						<i class="fas fa-sync"></i>
					</a>` + div.innerHTML;
		  });
	  }
	  
	  if(CustSidebarDirectory.haveEditPerms() || CustSidebarDirectory.haveControlPerms() || !game.settings.get("music-permissions", "limited-vision")){
		  html.find('.playlist-controls').each(function(num, div){
			 const li = div.closest(".playlist-header")
			 const playlist = game.playlists.get(li.dataset.documentId);
			 
			 if(playlist.permission == 1 && !game.settings.get("music-permissions", "limited-vision")){
				li.querySelector(".playlist-name").querySelector(".collapse").style.display = 'none'
				div.querySelectorAll(".sound-control").forEach( function(idiv){
					if(["Previous Sound", "Next Sound"].includes(idiv.title)) idiv.style.display = "none"
				});
			 }
			 
			 if((playlist.permission > 2) && CustSidebarDirectory.haveControlPerms()){
				div.innerHTML = div.innerHTML.replaceAll("disabled", "")
				if(playlist.mode == CONST.PLAYLIST_MODES.DISABLED){
					div.querySelectorAll(".sound-control").forEach( function(idiv){
						if(idiv.attributes["data-action"].nodeValue == "playlist-play"){
							idiv.disabled = true
						}
					});
				}
			 }
			 
			 
			 if(!div.innerHTML.includes("playlist-stop") && ((playlist.permission > 2 && CustSidebarDirectory.haveEditPerms()))){
				div.innerHTML = `
				<a class="sound-control" data-action="sound-create" title="` + game.i18n.localize('PLAYLIST.SoundCreate') + `">
					<i class="fas fa-plus"></i>
				</a>` + div.innerHTML;
			 }
		  });
	  }
	  
	  if(CustSidebarDirectory.haveCreatePerms()){
		  html.find('.folder-header').each(function(num, div){
			  const li = div.closest(".directory-item")
			  if(!li) return;
			  let folderId = li.dataset.folderId;
			  
			  div.innerHTML += `<a class="create-folder" data-parent-folder="` + folderId + 
			                   `"><i class="fas fa-folder-plus fa-fw"></i></a>
                                <a class="create-document" data-folder="` + folderId + 
							   `"><i class="fas fa-user-plus fa-fw"></i></a>`
		  });
	  }
	}
	super.activateListeners(html);

    // Volume sliders
    html.find('.global-volume-slider').change(this._onGlobalVolume.bind(this));
    html.find('.sound-volume').change(this._onSoundVolume.bind(this));

    // Collapse/Expand
    html.find(".playlist-name").click(this._onPlaylistCollapse.bind(this));
    html.find("#global-volume .playlist-header").click(this._onVolumeCollapse.bind(this))

    // Currently playing pinning
    html.find("#currently-playing .pin").click(this._onPlayingPin.bind(this));

    // All options below require a GM user
    if (false) return;

    // Playlist Control Events
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
  }

  /* -------------------------------------------- */

  /**
   * Handle global volume change for the playlist sidebar
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onGlobalVolume(event) {
    event.preventDefault();
    const slider = event.currentTarget;
    const volume = AudioHelper.inputToVolume(slider.value);
    return game.settings.set("core", slider.name, volume);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  collapseAll() {
    super.collapseAll();
    const el = this.element[0];
    for ( let p of el.querySelectorAll("li.playlist") ) {
      this._collapse(p, true);
    }
    this._expanded.clear();
    this._collapse(el.querySelector("#global-volume"), true);
    this._volumeExpanded = false;
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist collapse toggle
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onPlaylistCollapse(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".playlist");
    const playlistId = li.dataset.documentId;
    const wasExpanded = this._expanded.has(playlistId);
    this._collapse(li, wasExpanded);
    if ( wasExpanded ) this._expanded.delete(playlistId);
    else this._expanded.add(playlistId);
  }

  /* -------------------------------------------- */

  /**
   * Handle global volume control collapse toggle
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onVolumeCollapse(event) {
    event.preventDefault();
    const div = event.currentTarget.parentElement;
    this._volumeExpanded = !this._volumeExpanded;
    this._collapse(div, !this._volumeExpanded);
  }

  /* -------------------------------------------- */

  /**
   * Helper method to render the expansion or collapse of playlists
   * @private
   */
  _collapse(el, collapse, speed = 250) {
    const ol = el.querySelector(".playlist-sounds");
    const icon = el.querySelector("i.collapse");
    if (collapse) { // Collapse the sounds
      $(ol).slideUp(speed, () => {
        el.classList.add("collapsed");
        icon.classList.replace("fa-angle-down", "fa-angle-up");
      });
    }
    else { // Expand the sounds
      $(ol).slideDown(speed, () => {
        el.classList.remove("collapsed");
        icon.classList.replace("fa-angle-up", "fa-angle-down");
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist playback state changes
   * @param {MouseEvent} event    The initial click event
   * @param {boolean} playing     Is the playlist now playing?
   * @private
   */
  _onPlaylistPlay(event, playing) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
	const do_remote = (!game.user.isGM && playlist.permission >= game.settings.get("music-permissions", "min-control-perm"))
    if ( playing ){
		if(do_remote) return sendRemoteRequest({action:"playlist-playAll", target: li.dataset.documentId})
		MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
		return playlist.playAll();
	} else {
		if(do_remote) return sendRemoteRequest({action:"playlist-stopAll", target: li.dataset.documentId})
		MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
		return playlist.stopAll();
	}
  }

  /* -------------------------------------------- */

  /**
   * Handle advancing the playlist to the next (or previous) sound
   * @param {MouseEvent} event    The initial click event
   * @param {string} action       The control action requested
   * @private
   */
  _onPlaylistSkip(event, action) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
	
	let direction = action === "playlist-forward" ? 1 : -1
	
	const do_remote = (!game.user.isGM && playlist.permission >= game.settings.get("music-permissions", "min-control-perm"))
	if(do_remote) return sendRemoteRequest({
		action: "playlist-skip",
		target: li.dataset.documentId,
		data: direction
	});
    
	MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
	return playlist.playNext(undefined, {direction: direction});
  }

  /* -------------------------------------------- */

  /**
   * Handle cycling the playback mode for a Playlist
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onPlaylistToggleMode(event) {
    const li = event.currentTarget.closest(".playlist");
    const playlist = game.playlists.get(li.dataset.documentId);
    return playlist.cycleMode();
  }

  /* -------------------------------------------- */

  /**
   * Handle Playlist track addition request
   * @param {MouseEvent} event   The initial click event
   * @private
   */
  _onSoundCreate(event) {
    const li = $(event.currentTarget).parents('.playlist');
    const playlist = game.playlists.get(li.data("documentId"));
    const sound = new PlaylistSound({name: game.i18n.localize("SOUND.New")}, {parent: playlist});
    sound.sheet.render(true, {top: li[0].offsetTop, left: window.innerWidth - 670});
  }

  /* -------------------------------------------- */

  /**
   * Modify the playback state of a Sound within a Playlist
   * @param {MouseEvent} event    The initial click event
   * @param {string} action       The sound control action performed
   * @private
   */
  _onSoundPlay(event, action) {
    const li = event.currentTarget.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);
	const do_remote = (!game.user.isGM && playlist.permission >= game.settings.get("music-permissions", "min-control-perm"))
    switch ( action ) {
      case "sound-play":
	    MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
		if(do_remote) return sendRemoteRequest({action: "sound-play", target: li.dataset.soundId, playlist: li.dataset.playlistId})
        return playlist.playSound(sound);
      case "sound-pause":
	    MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
	    if(do_remote) return sendRemoteRequest({action: "sound-pause", target: li.dataset.soundId, playlist: li.dataset.playlistId})
        return sound.update({playing: false, pausedTime: sound.sound.currentTime});
      case "sound-stop":
	    MusicPermissions.sendRemoteForceNotif(playlist.id, "all")
		if(do_remote) return sendRemoteRequest({action: "sound-stop", target: li.dataset.soundId, playlist: li.dataset.playlistId})
		return playlist.stopSound(sound);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle volume adjustments to sounds within a Playlist
   * @param {Event} event   The initial change event
   * @private
   */
  _onSoundVolume(event) {
    event.preventDefault();
    const slider = event.currentTarget;
    const li = slider.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);

    // Get the desired target volume
    const volume = AudioHelper.inputToVolume(slider.value);
    if ( volume === sound.data.volume ) return;

    // Immediately apply a local adjustment
    if ( sound.sound ) {
      const localVolume = volume * game.settings.get("core", "globalPlaylistVolume");
      sound.sound.fade(localVolume, {duration: PlaylistSound.VOLUME_DEBOUNCE_MS});
    }

    // Debounce a change to the database
    if ( sound.isOwner ) sound.debounceVolume(volume);
  }

  /* -------------------------------------------- */

  /**
   * Handle changes to the sound playback mode
   * @param {Event} event   The initial click event
   * @private
   */
  _onSoundToggleMode(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".sound");
    const playlist = game.playlists.get(li.dataset.playlistId);
    const sound = playlist.sounds.get(li.dataset.soundId);
    return sound.update({repeat: !sound.data.repeat});
  }

  /* -------------------------------------------- */

  _onPlayingPin() {
    const location = this._playingLocation === "top" ? "bottom" : "top";
    return game.settings.set("core", "playlist.playingLocation", location);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onSearchFilter(event, query, rgx, html) {
    const isSearch = !!query;
    const playlistIds = new Set();
    const soundIds = new Set();
    const folderIds = new Set();

    // Match documents and folders
    if (isSearch) {

      // Match Playlists and Sounds
      for (let d of this.documents) {
        let matched = false;
        for (let s of d.sounds) {
          if (s.playing || rgx.test(SearchFilter.cleanQuery(s.name))) {
            soundIds.add(s.id);
            matched = true;
          }
        }
        if (matched || d.playing || rgx.test(SearchFilter.cleanQuery(d.name))) {
          playlistIds.add(d.id);
          if (d.data.folder) folderIds.add(d.data.folder);
        }
      }

      // Include parent Folders
      const folders = this.folders.sort((a, b) => a.depth - b.depth);
      for (let f of folders) {
        if (folderIds.has(f.id) && f.data.parent) {
          folderIds.add(f.data.parent);
        }
      }
    }

    // Toggle each directory item
    for (let el of html.querySelectorAll(".directory-item")) {
      if (el.classList.contains("global-volume")) continue;

      // Playlists
      if (el.classList.contains("document")) {
        const pid = el.dataset["documentId"];
        let mp = !isSearch || playlistIds.has(pid);
        el.style.display = mp ? "flex" : "none";

        // Sounds
        const sounds = el.querySelector(".playlist-sounds");
        for (let li of sounds.children ) {
          let ms = !isSearch || soundIds.has(li.dataset["soundId"])
          li.style.display = ms ? "flex" : "none";
          if ( ms ) mp = true;
        }
        let showExpanded = this._expanded.has(pid) || (isSearch && mp);
        el.classList.toggle("collapsed", !showExpanded);
      }

      // Folders
      else if (el.classList.contains("folder")) {
        let hidden = isSearch && !folderIds.has(el.dataset["folderId"]);
        el.style.display = hidden ? "none" : "flex";
        let expanded = (isSearch && folderIds.has(el.dataset["folderId"])) ||
          (!isSearch && game.folders._expanded[el.dataset.folderId]);
        el.classList.toggle("collapsed", !expanded);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Update the displayed timestamps for all currently playing audio sources.
   * Runs on an interval every 1000ms.
   * @private
   */
  _updateTimestamps() {
    if ( !this._playingSounds.length ) return;
    const playing = this.element.find("#currently-playing")[0];
    if ( !playing ) return;
    for ( let sound of this._playingSounds ) {
      const li = playing.querySelector(`.sound[data-sound-id="${sound.id}"]`);
      if ( !li ) continue;

      // Update current and max playback time
      const current = li.querySelector("span.current");
      const ct = sound.playing ? sound.sound.currentTime : sound.data.pausedTime;
      if ( current ) current.textContent = this._formatTimestamp(ct);
      const max = li.querySelector("span.duration");
      if ( max ) max.textContent = this._formatTimestamp(sound.sound.duration);

      // Remove the loading spinner
      const play = li.querySelector("a.pause i.fas");
      if ( play.classList.contains("fa-spinner") ) {
        play.classList.remove("fa-spin");
        play.classList.replace("fa-spinner", "fa-pause");
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Format the displayed timestamp given a number of seconds as input
   * @param {number} seconds    The current playback time in seconds
   * @returns {string}          The formatted timestamp
   * @private
   */
  _formatTimestamp(seconds) {
    seconds = seconds ?? 0;
    let minutes = Math.floor(seconds / 60);
    seconds = Math.round(seconds % 60);
    return `${minutes}:${seconds.paddedString(2)}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _contextMenu(html) {
    super._contextMenu(html);
    /**
     * A hook event that fires when the context menu for a Sound in the PlaylistDirectory is constructed.
     * @function getPlaylistDirectorySoundContext
     * @memberof hookEvents
     * @param {jQuery} html                     The HTML element to which the context options are attached
     * @param {ContextMenuEntry[]} entryOptions The context menu entries
     */
    ContextMenu.create(this, html, ".playlist .sound", this._getSoundContextOptions(), "SoundContext");
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getFolderContextOptions() {
    const options = super._getFolderContextOptions();
    return options;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getEntryContextOptions() {
    const options = super._getEntryContextOptions();
    options.unshift({
      name: "PLAYLIST.Edit",
      icon: '<i class="fas fa-edit"></i>',
	  condition: li => {
		  const playlist = game.playlists.get(li.data("document-id"));
		  return CustSidebarDirectory.haveEditPerms() && playlist.permission > 2;
	  },
      callback: li => {
        const playlist = game.playlists.get(li.data("document-id"));
        const sheet = playlist.sheet;
        sheet.render(true, this.popOut ? {} : {
          top: li[0].offsetTop - 24,
          left: window.innerWidth - ui.sidebar.position.width - sheet.options.width - 10
        });
      }
    })
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Get context menu options for individual sound effects
   * @return {Object}   The context options for each sound
   * @private
   */
  _getSoundContextOptions() {
    return [
      {
        name: "PLAYLIST.SoundEdit",
        icon: '<i class="fas fa-edit"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          const sheet = sound.sheet;
          sheet.render(true, this.popOut ? {} : {
            top: li[0].offsetTop - 24,
            left: window.innerWidth - ui.sidebar.position.width - sheet.options.width - 10
          });
        }
      },
      {
        name: "PLAYLIST.SoundPreload",
        icon: '<i class="fas fa-download"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          game.audio.preload(sound);
        }
      },
      {
        name: "PLAYLIST.SoundDelete",
        icon: '<i class="fas fa-trash"></i>',
        callback: li => {
          const playlistId = li.parents(".playlist").data("document-id");
          const playlist = game.playlists.get(playlistId);
          const sound = playlist.sounds.get(li.data("sound-id"));
          return sound.deleteDialog({
            top: Math.min(li[0].offsetTop, window.innerHeight - 350),
            left: window.innerWidth - 720
          })
        }
      },
    ];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragStart(event) {
    const target = event.currentTarget;
    if ( target.classList.contains("playlist-name") ) return super._onDragStart(event);
    const sound = target.closest(".sound");
    event.dataTransfer.setData("text/plain", JSON.stringify({
      playlistId: sound.dataset.playlistId,
      soundId: sound.dataset.soundId,
      type: "PlaylistSound"
    }));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDrop(event) {
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch(err) {
      return false;
    }

    if ( data.type !== "PlaylistSound" ) return super._onDrop(event);
    const target = event.target.closest(".sound, .playlist");
    if ( !target ) return false;
    const playlist = game.playlists.get(data.playlistId);
	if(!(playlist.permission > 2 && CustSidebarDirectory.haveEditPerms())) return false;
    const sound = playlist.sounds.get(data.soundId);
    const otherPlaylistId = target.dataset.documentId || target.dataset.playlistId;

    // Copying to another playlist.
    if ( otherPlaylistId !== data.playlistId ) {
      const otherPlaylist = game.playlists.get(otherPlaylistId);
      return PlaylistSound.implementation.create(sound.toObject(), {parent: otherPlaylist});
    }

    // If there's nothing to sort relative to, or the sound was dropped on itself, do nothing.
    const targetId = target.dataset.soundId;
    if ( !targetId || (targetId === data.soundId) ) return false;
    sound.sortRelative({
      target: playlist.sounds.get(targetId),
      siblings: playlist.sounds.filter(s => s.id !== data.soundId)
    });
  }
}

function handleSocketEvent(data, src){
	//console.log("Got socket data!");
	//console.log(data);
	
	if(!data.worker.includes("all") && !data.worker.includes(game.userId)) return;
	
	
	
	if(data.action == "force-notif" && (data.worker.includes("all") || data.worker.includes(game.userId)) && game.settings.get("music-permissions", "min-locals-role") != 5){
		MusicPermissions._force_next_reqs.push({playlistId: data.target, userId: src});
	}
	
	
	if(data.action == "error"){
		if(!game.users.get(src).isGM) return; //No sending other players errors for funsies.
		ui.notifications.error(new Error(data.err));
	} else if(!game.user.isGM){
		return; //I shouldn't be the worker for this, I don't have server permissions to do the actions below.
	}
	
	if(data.action == "folder-create"){
		if(!CustSidebarDirectory.haveCreatePerms(src)) return "You do not have permission to create folders!";
		if(data.data.type != "Playlist") return "You are not allowed to create folders outside of the playlist directory!";
		
		data.data.description = src;
		Folder.create(data.data);
	} else if(data.action == "folder-edit"){
		if(!CustSidebarDirectory.haveEditPerms(src)) return "You do not have permission to edit folders!";
		let folder = game.folders.get(data.target);
		if(!folder?.data.description.includes(src)) return "You cannot edit folders you did not create!";
		if(folder?.data.type != "Playlist") return "You are not allowed to edit folders outside of the playlist directory!";
		
		folder.update(data.data);
	} else if(data.action == "folder-remove"){
		if(!CustSidebarDirectory.haveEditPerms(src)) return "You do not have permission to remove folders!";
		let folder = game.folders.get(data.target);
		if(!folder?.data.description.includes(src)) return "You cannot remove folders you did not create!";
		if(folder?.data.type != "Playlist") return "You are not allowed to remove folders outside of the playlist directory!";
		
		folder.delete({deleteSubfolders: false, deleteContents: false})
	} else if(data.action == "playlist-create"){
		if(!CustSidebarDirectory.haveCreatePerms(src)) return "You do not have permission to create playlists!";
		return Playlist.create(data.data, {renderSheet: false}).then(function(playlist){
			perms = {}
			perms[src] = CONST.DOCUMENT_PERMISSION_LEVELS.OWNER;
			playlist.update({permission: perms});
		});
	} else {
		//Past this are all sound updates that aren't local and are manually done, send a force notif first.
		MusicPermissions.sendRemoteForceNotif(data.playlist ?? data.target, "all")
	}
	
	if(data.action == "playlist-playAll"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.target);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return "You do not have permission to play this playlist!";
		playlist.playAll();
	} else if(data.action == "playlist-stopAll"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.target);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return"You do not have permission to stop this playlist!";
		playlist.stopAll();
	} else if(data.action == "playlist-skip"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.target);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return"You do not have permission to control this playlist!";
		if(((playlist.data.permission[src]??playlist.data.permission["default"]) == 1) && !game.settings.get("music-permissions","limited-vision"))
			return "You cannot skip in playlists whose songs you cannot see!"
		playlist.playNext(undefined, {direction: data.data})
	} else if(data.action == "sound-play"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.playlist);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return "You do not have permission to play from this playlist!";
		let sound = playlist.sounds.get(data.target)
		if(!sound) return "Internal error: Cannot find sound!"
		playlist.playSound(sound);
	} else if(data.action == "sound-stop"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.playlist);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return "You do not have permission to stop sounds in this playlist!";
		let sound = playlist.sounds.get(data.target)
		if(!sound) return "Internal error: Cannot find sound!"
		playlist.stopSound(sound);
	} else if(data.action == "sound-pause"){
		if(!CustSidebarDirectory.haveControlPerms(src)) return "You do not have permission to control playback!";
		let playlist = game.playlists.get(data.playlist);
		if(!playlist) return "Internal error: Cannot find playlist!";
		if((playlist.data.permission[src]??playlist.data.permission["default"]) < game.settings.get("music-permissions","min-control-perm")) return "You do not have permission to pause sounds in this playlist!";
		let sound = playlist.sounds.get(data.target)
		if(!sound) return "Internal error: Cannot find sound!"
		sound.update({playing: false, pausedTime: sound.sound.currentTime});
	}
}


//Replacement for Sound objs that prevents updates from remote sources,
//so we can manually handle.
class MusicPermissionsSound extends Sound {
	constructor(soundSrc, autoplay = false, autoplay_info = {}){
		super(soundSrc.src);
		this.MusicPermissions = true;
		this.events = soundSrc.events;
		
		soundSrc.events = {
			end: {},
			pause: {},
			start: {},
			stop: {},
			load: {}
		}
		
		this._eventHandlerId = 1;
		for(let listName in this.events){
			for(let id in this.events[listName]){
				if(this._eventHandlerId <= id){
					this._eventHandlerId = id+1;
				}
			}
		}
		this._eventHandlerId += 100; //Just in case some events were added then removed, and they try to remove them again. Very unlikely, but whatever.
		
		if(autoplay){
			this.doing_internal = true;
			this.load({autoplay: true, autoplayOptions: autoplay_info}) //TODO: figure out how to also get correct volume here.
			this.doing_internal = false;
		}
		
	}
	
	  /**
	* Load the audio source, creating an AudioBuffer.
	* Audio loading is idempotent, it can be requested multiple times but only the first load request will be honored.
	* @param {object} [options={}]   Additional options which affect resource loading
	* @param {boolean} [options.autoplay=false]  Automatically begin playback of the audio source once loaded
	* @param {object} [options.autoplayOptions]  Additional options passed to the play method when loading is complete
	* @returns {Promise<Sound>}      The Sound once its source audio buffer is loaded
	*/
	async _load({autoplay=false, autoplayOptions={}}={}) {

		// Delay audio loading until after an observed user gesture
		if ( game.audio.locked ) {
			console.log(`${vtt} | Delaying load of sound ${this.src} until after first user gesture`);
			await new Promise(resolve => game.audio.pending.push(resolve));
		}

		// Currently loading
		if ( this.loading instanceof Promise ) await this.loading;

		// If loading is required, cache the promise for idempotency
		if ( !this.container || this.container.loadState === AudioContainer.LOAD_STATES.NONE ) {
			this.loading = this.container.load();
			await this.loading;
			this.loading = undefined;
		}

		// Trigger automatic playback actions
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		if ( autoplay ) this.play(autoplayOptions);
		this.doing_internal = doing_internal;
		return this;
	}
	
	load({autoplay=false, autoplayOptions={}}={}) {
		if(!MusicPermissions._doing_local_update && !this.doing_internal) return this;
		this._load({autoplay: autoplay, autoplayOptions: autoplayOptions});
	}

	
	fade(volume, {duration=1000, from, type="linear"}={}){
		if(!MusicPermissions._doing_local_update && !this.doing_internal) return Promise.resolve(1);
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.fade(volume, {duration: duration, from: from, type:type});
		this.doing_internal = doing_internal;
		return ret;
	}
	
	play({loop=false, offset, volume, fade=0}){
		if(!MusicPermissions._doing_local_update && !this.doing_internal && !this.playing) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.play({loop:loop, offset: offset, volume: volume, fade: fade});
		this.doing_internal = doing_internal;
		return ret;
	}
	
	pause(){
		if(!MusicPermissions._doing_local_update && !this.doing_internal) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.pause()
		this.doing_internal = doing_internal;
		return ret;
	}
	
	stop(){
		if(!MusicPermissions._doing_local_update && !this.doing_internal && !MusicPermissions._sounds_to_stop.includes(this)) return;
		let doing_internal = this.doing_internal;
		this.doing_internal = true;
		let ret = super.stop();
		this.doing_internal = doing_internal;
		return ret;
	}

	//Must manually copy all static entries, like get/set.

	/* -------------------------------------------- */
	/*  Properties                                  */
	/* -------------------------------------------- */

	/**
	* A convenience reference to the sound context used by the application
	* @returns {AudioContext}
	*/
	get context() {
		return super.context;
	}

	/**
	* A reference to the audio source node being used by the AudioContainer
	* @returns {AudioBufferSourceNode|MediaElementAudioSourceNode}
	*/
	get node() {
		return super.node;
	}

	/**
	* A reference to the GainNode parameter which controls volume
	* @type {AudioParam}
	*/
	get gain() {
		return super.gain;
	}

	/**
	* The current playback time of the sound
	* @returns {number}
	*/
	get currentTime() {
		return super.currentTime
	}

	/**
	* The total sound duration, in seconds
	* @type {number}
	*/
	get duration() {
		return super.duration
	}

	/**
	* Is the contained audio node loaded and ready for playback?
	* @type {boolean}
	*/
	get loaded() {
		return super.loaded
	}

	/**
	* Did the contained audio node fail to load?
	* @type {boolean}
	*/
	get failed() {
		return super.failed
	}

	/**
	* Is the audio source currently playing?
	* @type {boolean}
	*/
	get playing() {
		return super.playing
	}

	/**
	* Is the Sound current looping?
	* @type {boolean}
	*/
	get loop() {
		return super.loop
	}
	set loop(looping) {
		super.loop = looping;
	}

	/**
	* The volume at which the Sound is playing
	* @returns {number}
	*/
	get volume() {
		return super.volume
	}
	set volume(value) {
		super.volume = value
	}
	
	
}

Hooks.once("ready", async function () {	
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
		hint: "What roll is needed to allow a user to control people's local playback settings?",
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
		default: 5,
		onChange: value => {
			ui["playlists"].render(true);
		}
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

	game.socket.on('module.music-permissions', function(data, src){
		let err = handleSocketEvent(data, src);
		if(!err) return;
		game.socket.emit("module.music-permissions", {
			worker: src,
			action: "error",
			err: err
		});
	});

	ui['playlists'] = new CustPlaylistDirectory()
	ui['playlists'].render(true)
	
	Hooks.on("updatePlaylist", function(playlist, change, info, userId){
		if('permission' in change) ui["playlists"].render(true);
		
		if(game.settings.get("music-permissions", "min-locals-role") == 5) return;
		
		change.sounds?.forEach(soundChange => {
			if("path" in soundChange){
				//sound.sound was replaced with a new Sound, not our MusicPermissionsSound.
				let sound = game.playlists.get(playlist.id)?.sounds?.get(soundChange._id)
				if(!sound) return;
				sound.sound = new MusicPermissionsSound(sound.sound);
				if(sound.playing){
					MusicPermissions._doing_local_update = true;
					sound.sync()
					MusicPermissions._doing_local_update = true;
				}
			}
		})
		
		if(userId != "local"){
			if(MusicPermissions._doing_local_update){
				console.log("Music Permissions: A remote update ran in the middle of a local one, changes were pushed to sounds :( Should be fine, but poorly tested.")
				MusicPermissions.caught_interleaving = true;
			}
			MusicPermissions._render_on_local_updates = false;
			MusicPermissions._handle_remote_change(playlist, change, userId);
			MusicPermissions._render_on_local_updates = true;
		}
	});
	
	Hooks.on("updatePlaylistSound", function(playlistSound, change, info, userId){
		if('permission' in change) ui["playlists"].render(true);
		
		if(game.settings.get("music-permissions", "min-locals-role") == 5) return;
		

		if("path" in change){
			//playlistSound.sound was replaced with a new Sound, not our MusicPermissionsSound.
			playlistSound.sound = new MusicPermissionsSound(playlistSound.sound);
			if(playlistSound.playing){
				MusicPermissions._doing_local_update = true;
				playlistSound.sync()
				MusicPermissions._doing_local_update = false;
			}
		}

		
		if(userId != "local"){
			if(MusicPermissions._doing_local_update){
				console.log("Music Permissions: A remote update ran in the middle of a local one, changes were pushed to sounds :(")
				MusicPermissions.caught_interleaving = true;
			}
			MusicPermissions._render_on_local_updates = false;
			MusicPermissions._handle_remote_change(playlistSound, change, userId, true);
			MusicPermissions._render_on_local_updates = true;
		}
	});
	
	Hooks.on("createPlaylistSound", function(sound, options, userId){ //TODO: test that this actually works.
		if(game.settings.get("music-permissions", "min-locals-role") == 5) return;
		sound.sound = new MusicPermissionsSound(sound.sound);
	})
	
	//Replace all Sound objs with MusicPermissionsSound objs.
	if(game.settings.get("music-permissions", "min-locals-role") == 5) return;

	game.audio.pending = []//Remove any of the old Sound objs scheduled to play
	//TODO: rerun this when settings change to enable local sounds, and undo this when changed in the other direction.
	game.playlists.forEach(playlist => {
		playlist.sounds.forEach(sound => {
			sound.sound = new MusicPermissionsSound(sound.sound);
			if(sound.playing){
				MusicPermissions._doing_local_update = true;
				sound.sync()
				MusicPermissions._doing_local_update = false;
			}
		})
	})
});

//Separate the functions we're defining.
//Variables and functions prefixed with an underscore are internal use only. DO NOT USE DIRECTLY. Unless you want to, I'm not your boss.
//		If you're finding yourself having to use the internal only stuff, ideally make an issue in github to request the functionality
//		you're wanting - to help others.
//EXPERIMENTAL
class MusicPermissions{
	static _user_locals_known = new Map(); //userId -> playlistId -> soundId -> {playing: , paused: , callbackIds: map callback name -> callbackId, soundSrc: Sound (not PlaylistSound!)}
	
	//Internal use only (Unless you wanna, I'm not your boss.)
	//Promise w/ a short delay before running a render of the playlist dir, to catch when a bunch of updates come in quickly.
	static _handling_updates = null;
	
	//Fill with {playlistId, userId} for requested playlist and requesting userId of remote commands we should actually listen to.
	static _force_next_reqs = [];
	
	static _sounds_to_stop = [];
	
	static _handling_real_updates = true;
	static _render_on_local_updates = true;
	static _caught_interleaving = false;
	
	static _doing_local_update = false;
	//isReal=false to locally update w/o changing sound states (IE when fixing playlist from a rejected remote update)
	static _local_update(update, render = null, isReal = null, second_run = false){
		if(render === null) render = MusicPermissions._render_on_local_updates
		if(isReal === null) isReal = MusicPermissions._handling_real_updates;
		if(isReal) MusicPermissions._doing_local_update = true;
		try {
			let opts = {}
			if(!render) opts.render = false;
			//console.log("Starting local update, is real: " + isReal);
			if(isReal){
				let playlist = game.playlists.get(update._id);
				let localPlaylistInfo = MusicPermissions._user_locals_known.get(game.userId)?.get(update._id);
				update.sounds?.forEach(soundChange => {
					let playlistSound = playlist?.sounds.get(soundChange._id);
					if(!playlistSound) return;
					
					if((playlistSound.playing || playlistSound.paused) && (!soundChange.playing && !soundChange.pausedTime)){
						//We currently show this sound as playing and want to stop it
						MusicPermissions._sounds_to_stop.push(playlistSound.sound);
					}
				});
			}
			globalThis.CONFIG.DatabaseBackend._handleUpdateDocuments({request: {type: "Playlist", options: opts, pack: null}, result: [update], userId: "local"});
			if(isReal) MusicPermissions._doing_local_update = false;
		} catch (err){
			if(!second_run) MusicPermissions.restorePlaylistToLocal(update.id, true);
			MusicPermissions._sounds_to_stop = [];
			if(isReal) MusicPermissions._doing_local_update = false;
			throw(err);
		}
	}
	
	static _rm_local_callbacks(soundInfo){
		let callbacks = soundInfo?.callbackIds;
		if(!callbacks) return;
		
		let sound = soundInfo.soundSrc;
		if(!sound) return;
		
		for( [name, id] in callbacks ){
			sound.off(name, id);
		}
		
		callbacks.clear();
	}
	
	//soundInfo = {playing: bool, paused: bool, callbackIds: map(callback name, callbackId)}
	static _add_sound_locally(playlistId, soundId, soundInfo, globalState){
		let my_locals = MusicPermissions._user_locals_known.get(game.userId)
		if(!my_locals){
			my_locals = new Map();
			MusicPermissions._user_locals_known.set(game.userId, my_locals)
			my_locals.set(playlistId, new Map());
			my_locals.get(playlistId).set(soundId, {});
		}
		
		let my_playlists = my_locals.get(playlistId);
		if(!my_playlists){
			my_playlists = new Map();
			my_locals.set(playlistId, my_playlists);
		}
		
		soundInfo.global = globalState;
		my_playlists.set(soundId, soundInfo);
	}
	
	static _del_multiple_sounds_locally(playlistId, soundIds){
		if(!soundIds || soundIds.length == 0) return;
		let sounds = MusicPermissions._user_locals_known.get(game.userId)?.get(playlistId);
		if(!sounds) return;
		
		soundIds.forEach(soundId => {
			if(!sounds) return; //May have deleted this playlist already
			MusicPermissions._rm_local_callbacks(sounds.get(soundId));		
			sounds.delete(soundId);
			if(sounds.length == 0){
				my_locals.delete(playlistId);
			}
		});
	}
	
	static _del_sound_locally(playlistId, soundId){
		if(!soundId) return;
		MusicPermissions._del_multiple_sounds_locally(playlistId, [soundId]);
	}
	
	static _del_playlist_locally(playlistId){
		let toDel = game.playlists.get(playlistId)?.sounds?.map(sound => sound.id);
		MusicPermissions._del_multiple_sounds_locally(playlistId, toDel);
	}
	
	//Add extra_namespace to also broadcast to another module. //TODO
	static _broadcast_local_sounds(extra_namespace = null){
		
	}
	
	//TODO
	static _handle_sounds_update(userId, newSounds){
		
	}
	
	static _attach_play_sound_callback(playlistId, soundId){
		let playlist = game.playlists.get(playlistId)
		let soundSrc = playlist?.sounds.get(soundId).sound;
		if(!soundSrc) return;
		
		soundSrc.events = {
			end: {},
			pause: {},
			start: {},
			stop: {},
			load: {}
		}; //This probably isn't the best way to do this...
		   //TODO: See if we can just not transfer hooks from the original Sound to MusicPermissionsSound
		   //Ideally we don't erase any events other modules have attached. Seems a bit unlikely that they would have though.
		
		function callback_template_end(soundId, baseSoundObj) {
			if ( ![CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(this.mode) ){
				//Either soundboard mode or some new mode, just stop this sound.
				MusicPermissions.stopSoundLocally(this.id, soundId);
				return;
			}

			// Determine the next sound
			if ( !soundId ) {
			  const current = this.sounds.find(s => s.playing);
			  soundId = current?.id || null;
			}
			let next = this._getNextSound(soundId).id;
			if ( !this.data.playing ) next = null;

			
			// Enact playlist updates
			MusicPermissions.playSoundLocally(this.id, next);
		}
		
		let callback_end = callback_template_end.bind(playlist, soundId);
		let callbackId = soundSrc.on("end", callback_end, {once: true});


		let soundInfo = MusicPermissions._user_locals_known.get(game.userId)?.get(playlistId)?.get(soundId)
		if(!soundInfo){
			//This shouldn't happen!
			console.log("Music Permissions Error: Attaching callback to sound not playing locally. Please report this to the github!");
			soundSrc.off("end", callbackId);
		}
		
		MusicPermissions._rm_local_callbacks(soundInfo);
		soundInfo.soundSrc = soundSrc;
		if(!soundInfo.callbackIds) soundInfo.callbackIds = new Map();
		soundInfo.callbackIds.set("end", callbackId);
	}
	
	static playMultipleSoundsLocally(playlistId, soundIds, seed = null){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		if(playlist.mode != CONST.PLAYLIST_MODES.SIMULTANEOUS) return;
		
		let oldSoundStates = new Map()
		let newSounds = soundIds.map(soundId => {
			if(!MusicPermissions._user_locals_known.get(playlistId)?.get(soundId)){
				oldSoundStates.set(soundId, {playing: playlist.sounds.get(soundId).playing, paused: playlist.sounds.get(soundId).pausedTime})
			}
			return {_id: soundId, playing: true}
		});
		playlist_change = {_id: playlistId, playing: true, sounds: newSounds}
		if(seed) playlist_change.seed = seed;
		
		MusicPermissions._local_update(playlist_change);
		
		soundIds.forEach(soundId => {
			let local_sound_info = MusicPermissions._user_locals_known.get(playlistId)?.get(soundId)
			if(local_sound_info){
				local_sound_info.playing = true;
			} else {
				MusicPermissions._add_sound_locally(playlistId, soundId, {playing: true, paused: oldSoundStates.get(soundId).paused}, oldSoundStates.get(soundId));
			}
			MusicPermissions._attach_play_sound_callback(playlistId, soundId);
		});
	}

	static playSoundLocally(playlistId, soundId, seed = null){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let newSounds = [];
		
		if ( [CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(playlist.mode) ){
			let localPlaylistInfo = MusicPermissions._user_locals_known.get(game.userId)?.get(playlistId)
			//These modes can only have one sound playing at a time. End all currently playing sounds.
			playlist.sounds.forEach(playlistSound => {
				if(playlistSound.playing){
					if(playlistSound.id != soundId){
						newSounds.push({_id: playlistSound.id, playing: false, pausedTime: undefined})
					}
					
					let localInfo = localPlaylistInfo?.get(playlistSound.id);
					if(localInfo){
						MusicPermissions._rm_local_callbacks(localInfo)
						localInfo.playing = false;
					} else {
						MusicPermissions._add_sound_locally(playlistId, playlistSound.id, {playing: false, paused: undefined}, {playing: true, paused: undefined})
					}
				}
			});
		}
		
		newSounds.push({_id: soundId, playing: true});
		let info = MusicPermissions._user_locals_known.get(game.userId)?.get(playlistId)?.localPlaylistInfo?.get(SoundId)
		if(info){
			info.playing = true
			info.paused = undefined;
		} else {
			let playlistSound = playlist.sounds.get(soundId)
			MusicPermissions._add_sound_locally(playlistId, soundId, {playing: true, paused: playlistSound.pausedTime}, {playing: playlistSound.playing, paused: playlistSound.pausedTime})
		}
		
		let playlist_change = {_id: playlistId, playing: true, sounds: newSounds}
		if(seed != null){
			playlist_change.seed = seed;
		}
		
		MusicPermissions._local_update(playlist_change);

		MusicPermissions._attach_play_sound_callback(playlistId, soundId);
	}
	
	static stopSoundLocally(playlistId, soundId){
		return MusicPermissons.stopMultipleSoundsLocally(playlistId, [soundId]);
	}
	
	static stopMultipleSoundsLocally(playlistId, soundIds, playlistStop = false){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let my_locals = MusicPermissions._user_locals_known.get(game.userId)
		
		
		soundIds.forEach(soundId => {
			let info = my_locals?.get(playlistId)?.get(soundId)
			if(info){
				MusicPermissions._rm_local_callbacks(info)
				info.playing = false;
				if(!playlistStop) info.paused = undefined;
			} else {
				let sound = playlist.sounds.get(soundId)
				let pausedInfo = playlistStop ? sound.pausedTime : undefined;
				MusicPermissions._add_sound_locally(playlistId, soundId, {playing: false, paused: pausedInfo}, {playing: sound.playing, paused: sound.pausedTime});
			}
		})
		
		let playing = false;
		for(const [playlistSoundId, playlistSound] in playlist.sounds){
			if(!soundIds.includes(playlistSoundId) && playlistSound.playing){
				playing = true;
				break;
			}
		}
		
		let soundChanges = soundIds.map( soundId => { return{_id: soundId, playing: false}})
		if(!playlistStop) soundChanges.forEach(soundChange => soundChange.pausedTime = undefined);
		
		MusicPermissions._local_update({_id: playlistId, playing: playing, sounds: soundChanges})
	}
	
	static pauseMultipleSoundsLocally(playlistId, soundIds){
		if(!soundIds || soundIds.length == 0) return;
		let playlist = game.playlists.get(playlistId)
		let playlistSounds = playlist?.sounds
		if(!playlistSounds) return;
		
		let playlistInfo = MusicPermissions._user_locals_known.get(game.userId)?.get(playlistId)
		soundIds.forEach(soundId => {
			let info = playlistInfo?.get(soundId)
			let sound = playlistSounds.get(soundId);
			if(!sound) return;
			
			if(info){
				MusicPermissions._rm_local_callbacks(info)
				info.playing = false;
				info.paused = sound.sound.currentTime;
			} else {
				let sound = playlist.sounds.get(soundId)
				MusicPermissions._add_sound_locally(playlistId, soundId, {playing: false, paused: sound.sound.currentTime}, {playing: sound.playing, paused: sound.data.pausedTime});
			}
		})
		
		let playing = false;
		playlistSounds.find(playlistSound =>{
			if(!soundIds.includes(playlistSound.id) && (playlistSound.playing || playlistSound.pausedTime)){
				playing = true;
				return true;
			}
		});
		
		let changes = soundIds.filter(soundId => playlistSounds.get(soundId)?.playing);
		changes = changes.map(soundId => {return {_id: soundId, playing: false, pausedTime: playlistSounds.get(soundId).sound.currentTime}})
		
		MusicPermissions._local_update({_id: playlistId, playing: playing || changes.length > 0, sounds: changes})
	}
	
	static pauseSoundLocally(playlistId, soundId){
		return MusicPermissions.pauseMultipleSoundsLocally(playlistId, [soundId]);
	}
	
	static playPlaylistLocally(playlistId){
		let playlist = game.playlists.get(playlistId);
		if(!playlist) return;

		//Currently foundry doesn't support playing a playlist in simultaneous (soundboard) mode, so for consistency we won't here either.		
		if ( !([CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(this.mode)) ) return;

		const paused = playlist.sounds.find(s => s.data.pausedTime);
        const nextId = paused?.id || playlist.playbackOrder[0];
		MusicPermissions.playSoundLocally(playlistId, nextId);
	}
	
	static stopPlaylistLocally(playlistId){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let soundIds = playlist.sounds.map(sound => sound.id)
		MusicPermissions.stopMultipleSoundsLocally(playlistId, soundIds, true)
	}
	
	//returns {_id:playlistId, playing: playlist.playing, sounds = [_id: soundId, playing: sound.playing, pausedTime: sound.pausedTime]}
	//pausedTime is a best-effort guess, to better synchronize it'd be best to stop/play instead of playing from pause.
	static getPlaylistGlobalState(playlistId){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return;
		
		let state = {_id: playlistId, playing: false, sounds: []};
		
		let myLocal = MusicPermissions._user_locals_known.get(game.userID)?.get(playlistId)
		playlist.sounds.forEach(sound => {
			let info = myLocal?.get(sound.id);
			if(info){
				state.sounds.push({playing: info.global.playing, pausedTime: info.global.paused})
				if(info.global.playing) state.playing = true;
			} else {
				state.sounds.push({playing: sound.playing, pausedTime: sound.pausedTime})
				if(sound.playing) state.playing = true;
			}
		});
		return state;
	}
	
	//Based on local info, not asking the user. May be very slightly old info, though pausedTime specifically may be off a bit more (though the truthiness of it should be accurate).
	//Try MusicPermissions.updateLocalInfos to force everyone to update eachother's local information if you find yourself having issues. Shouldn't be needed for typical use though.
	static getPlaylistLocalState(playlistId, userId){
		let playlist = game.playlists.get(playlistId);
		if(!playlist) return;
		
		globalState = MusicPermissions.getPlaylistGlobalState(playlistId);
		
		let userInfo = MusicPermissions._user_locals_known.get(userId)?.get(playlistId);
		if(!userInfo) return globalState;
		for( [soundId, info] in userInfo ){
			let idx = globalState.sounds.findIndex(sound => sound._id == soundId);
			if(idx == -1) continue;
			let globalInfo = globalState.sounds[idx];
			globalInfo.playing = info.playing;
			globalInfo.pausedTime = info.paused;
		}
		return globalState
	}
	
	static sendRemoteForceNotif(playlistId, workers){
		game.socket.emit("module.music-permissions", {action: "force-notif", target: playlistId, worker: workers});
		
		if(workers.includes("all") || workers.includes(game.userId)) MusicPermissions._force_next_reqs.push({playlistId: playlistId, userId: game.userId});
	}
	
	//Requests that userIds broadcast their local info to everyone. "all" just have everyone update eachother.
	static updateLocalInfos(userIds = ["all"]){
		game.socket.emit("module.music-permissions", {action: "update-local-info", worker: userIds});
	}
	
	static restorePlaylistToLocal(playlistId, second_run = false){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return
		
		let isPlaying = false;
		let soundChanges = []
		let realSoundChanges = []
		let localPlaylist = MusicPermissions._user_locals_known.get(game.userId)?.get(playlist.id);
		playlist.sounds.forEach(sound => {
			if(sound.pausedTime != sound.sound.pausedTime || sound.playing != sound.sound.playing){
				soundChanges.push({_id: sound.id, playing: sound.sound.playing, pausedTime: sound.sound.pausedTime})
			}
			if(sound.sound.playing) isPlaying = true
			
			let localSound = localPlaylist?.get(sound.id)
			if(!localSound) return;
			if(localSound.pauseTime != sound.sound.pausedTime || localSound.playing != sound.sound.playing){
				if(!MusicPermissions._caught_interleaving){
					console.log("MusicPermissions: Warning, found a sound with a different state than our local changes suggest. Please report to the github!")
					console.log("MusicPermissions: Bad state on playlist: \"" + playlistId + "\" sound: \"" + sound.id + "\". Dumping status below:");
					console.log(game.playlists)
					console.log(MusicPermissions._user_locals_known.get(game.userId))
				}
				realSoundChanges.push({_id: sound.id, playing: localSound.playing, pausedTime: localSound.paused});
			}
		});
		let doRender = MusicPermissions._render_on_local_updates; //Don't render after this update if the caller requested so.
		let isReal = false; //This update isn't "real", ie we don't need to change the underlying sound state, just the playlist/playlistSound status.
		MusicPermissions._local_update({_id: playlistId, playing: isPlaying, sounds: soundChanges}, doRender, isReal, second_run)
		
		if(realSoundChanges.length > 0){
			isReal = true; //These changes need to be propogated to the underlying sound states
			MusicPermissions._local_update({_id: playlistId, playing: isPlaying, sounds: realSoundChanges}, doRender, isReal, second_run)
		}
		
		if(MusicPermissions._caught_interleaving) MusicPermissions._caught_interleaving = false;
	}
	
	static debugRestorePlaylistToCurrent(playlistId){
		let playlist = game.playlists.get(playlistId)
		if(!playlist) return
		
		playlist.sounds.forEach(sound =>{
			sound.sync();
		});
		
		ui["playlists"].render(true)
	}
	
	static _handle_remote_change(playlist, change, userId, playlistSound = false){
		//Since the update wasn't local, no changes were made to the actual playing sounds
		//So if they should have been, we just run the change again and update our internal stuff.
		//We need to undo the changes in the playlist info by formatting and sending an undo change, or we 
		//	end up with changes not being applied to the underlying sounds.
		if(playlistSound){
			//This is from a PlaylistSound update, so we'll reform the change to play nicely.
			let playlistSound = playlist;
			playlist = playlistSound.parent
			
			let playlistSoundChange = change;
			change = {_id: playlist.id, sounds: [playlistSoundChange]}
		}
		
		MusicPermissions.restorePlaylistToLocal(playlist.id);
		
		if(change.sounds.length < 1){
			Console.log("Music Permissions: Warning, got playlist update w/ no sound info. Weird.")
			return;
		}
		
		let removed_one = false; //Only remove one if we have had multiple requests to force.
		MusicPermissions._force_next_reqs = MusicPermissions._force_next_reqs.filter(toForce => {
			if(!removed_one && toForce.playlistId == playlist.id && toForce.userId == userId){
				removed_one = true;
				return false;
			}
			return true;
		})
		
		if(removed_one){
			//This update should be forced through.
			if([CONST.PLAYLIST_MODES.SEQUENTIAL, CONST.PLAYLIST_MODES.SHUFFLE].includes(playlist.mode)){
				//Only one thing should play at a time, so we accept all changes suggested. Easy!
				let nowPlaying = change.sounds.filter(soundChange => {return soundChange.playing == true});
				if(nowPlaying.length > 0) {
					if(nowPlaying.length > 1) console.log("MusicPermissions: Warning, got remote request to play multiple songs on sequential/shuffle playlist. Only playing first.");
					MusicPermissions.playSoundLocally(playlist.id, nowPlaying[0]._id)
					MusicPermissions._del_playlist_locally(playlist.id);
				} else {
					let attempted_changes = change.sounds.map(sChange => sChange._id)
					let changed_sounds = playlist.sounds.filter(sound => sound.playing).map(sound => sound.id).filter(soundId => attempted_changes.includes(soundId));
					if(change.sounds[0].pausedTime){
						//Pause any song locally playing. Should just be one for this playlist mode, but just in case handle the case of multiple.
						MusicPermissions.pauseMultipleSoundsLocally(playlist.id, changed_sounds)
					} else {
						//stop any song locally playing or paused. Should just be one for this playlist mode, but just in case handle the case of multiple.
						MusicPermissions.stopMultipleSoundsLocally(playlist.id, changed_sounds)
					}
					let localPlaylist = MusicPermissions._user_locals_known.get(game.userId)?.get(playlist.id);
					MusicPermissions._del_multiple_sounds_locally(playlist.id, changed_sounds) //Remove from locally-changed anything that we just updated to match global.
				}
			} else {
				//Apply all changes, no worries.
				MusicPermissions._local_update(change);
				
				let localPlaylist = MusicPermissions._user_locals_known.get(game.userId)?.get(playlist.id)
				change.sounds.map(sound => sound.soundId).forEach(soundId => localPlaylist?.delete(soundId));
			}
		} else {
			//This is an update that shouldn't be forced through.
			//Should just be a play update, those are the only auto ones?
			if(!MusicPermissions._user_locals_known.get(game.userId)?.get(playlist.id)){
				//Only handle the play if we don't have any local changes to playlist.
				MusicPermissions._local_update(change)
				MusicPermissions._del_playlist_locally(playlist.id);
			} //TODO: else, update info.global for any infos we have that we're ignoring changes to.
			
		}
	}
}