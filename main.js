const { Plugin } = require('obsidian');

module.exports = class InstagramPreviewPlugin extends Plugin {

	undoAction() {
		if (this.undoStack.length === 0) return;
		const last = this.undoStack.pop();
		this.redoStack.push(last);
		this.applyContentChange(last.file, last.oldContent);

		// 🔁 Update buttons using fresh reference
		// setTimeout(() => {
		// 	if (this.lastRenderedEl) this.updateUndoRedoButtons(this.lastRenderedEl);
		// }, 300);
	}

	
	redoAction() {
		if (this.redoStack.length === 0) return;
		const last = this.redoStack.pop();
		this.undoStack.push(last);
		this.applyContentChange(last.file, last.newContent);

		// 🔁 Update buttons using fresh reference
		// setTimeout(() => {
		// 	if (this.lastRenderedEl) this.updateUndoRedoButtons(this.lastRenderedEl);
		// }, 300);
	}

	
	async applyContentChange(filePath, newContent) {
	const file = this.app.vault.getAbstractFileByPath(filePath);
	if (!file) return;

	// 🧠 Prepopulate responseCache with any previews from tempPreviewCache
	const urls = newContent.match(/```instagram\s*([\s\S]*?)```/g)
		?.flatMap(block => block.replace(/```instagram|```/g, "").trim().split(/[,\n]+/).map(s => s.trim()))
		.filter(Boolean) || [];

	for (const url of urls) {
		const tempKey = `${filePath}:${url}`;
		if (this.tempPreviewCache.has(tempKey)) {
			const data = this.tempPreviewCache.get(tempKey);
			this.responseCache.set(url, data);
			if (!this.persistentCache[filePath]) this.persistentCache[filePath] = {};
			this.persistentCache[filePath][url] = data;
		}
	}
	await this.saveData({ persistentCache: this.persistentCache });

	await this.app.vault.modify(file, newContent);

	setTimeout(() => {
		const previewEls = document.querySelectorAll(".preview-wrapper");
		if (!previewEls.length) return;

		const latestPreviewEl = previewEls[0];
		this.lastRenderedEl = latestPreviewEl;
		this.updateUndoRedoButtons(latestPreviewEl);
	}, 300);
}



	
	async onload() {

		this.tempPreviewCache = new Map();

		console.log("Instagram Preview Plugin loaded");

		this.responseCache = new Map();
		this.htmlCache = new Map();

		this.undoStack = [];
		this.redoStack = [];

		this.addCommand({
			id: 'undo-instagram-preview-change',
			name: 'Undo Instagram Preview Change',
			callback: () => this.undoAction()
		});
		
		this.addCommand({
			id: 'redo-instagram-preview-change',
			name: 'Redo Instagram Preview Change',
			callback: () => this.redoAction()
		});
		

		

		try {
			const saved = await this.loadData();
			this.persistentCache = saved?.persistentCache || {};
			console.log("Loaded persistent cache with keys:", Object.keys(this.persistentCache));
		} catch (err) {
			console.error("Failed to load persistent cache:", err);
			this.persistentCache = {};
		}

		this.registerMarkdownCodeBlockProcessor("instagram", async (source, el, ctx) => {
			const urls = source.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
			
			if (!urls.length) {
				el.innerHTML = `<p style="color:red;">No Instagram URLs provided.</p>`;
				return;
			}

			const noteKey = ctx.sourcePath;
			const existingUrls = this.persistentCache[noteKey] ? Object.keys(this.persistentCache[noteKey]) : [];
			const currentUrls = urls;

			const removedUrls = existingUrls.filter(url => !currentUrls.includes(url));
			for (const removedUrl of removedUrls) {
				delete this.persistentCache[noteKey][removedUrl];
				this.responseCache.delete(removedUrl);
			}

			if (!this.persistentCache[noteKey]) {
				this.persistentCache[noteKey] = {};
			}
			await this.saveData({ persistentCache: this.persistentCache });


			const blockKey = `${ctx.sourcePath}:${hash(source)}`;
			if (this.htmlCache.has(blockKey)) {
				el.innerHTML = this.htmlCache.get(blockKey);
				this.rebindAllButtons(el, ctx.sourcePath, source);
				return;
			}

			const cachedPreviews = [];
			const urlsToFetch = [];

			for (const url of urls) {
				const tempKey = `${noteKey}:${url}`;
				if (this.persistentCache[noteKey][url]) {
					const data = this.persistentCache[noteKey][url];
					this.responseCache.set(url, data);
					cachedPreviews.push(data);
				} else if (this.tempPreviewCache.has(tempKey)) {
					const data = this.tempPreviewCache.get(tempKey);
					this.responseCache.set(url, data);
					cachedPreviews.push(data);
				} else {
					urlsToFetch.push(url);
				}

			}

			let fetchedPreviews = [];
			if (urlsToFetch.length) {
				try {
					const res = await fetch("http://localhost:8000/link-preview", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ url: urlsToFetch.join(",") }),
					});
					if (!res.ok) throw new Error("Failed to fetch preview");
					fetchedPreviews = await res.json();

					urlsToFetch.forEach((url, i) => {
						this.responseCache.set(url, fetchedPreviews[i]);
						this.persistentCache[noteKey][url] = fetchedPreviews[i];
					});
					await this.saveData({ persistentCache: this.persistentCache });
				} catch (err) {
					console.error(err);
					el.innerHTML = `<p style="color:red;">Error fetching preview</p>`;
					return;
				}
			}

			const allPreviews = urls.map(url => this.responseCache.get(url));

			let html = `
<div class="refresh-all-btn-wrapper">
	<button class="refresh-all-btn" data-note="${noteKey}" data-source="${encodeURIComponent(source)}">
		🔃Refresh All
	</button>
	<div class="instagram-controls">
		<button class="undo-btn" disabled>↩️ Undo</button>
		<button class="redo-btn" disabled>↪️ Redo</button>
	</div>
	<button class="delete-all-btn" data-note="${noteKey}" data-source="${encodeURIComponent(source)}">Delete All🗑️</button>
</div>
<div class="preview-wrapper"><div class="preview-container">
`;


			allPreviews.forEach((data, index) => {
				const imageSrc = data.img || "https://via.placeholder.com/300x300/eeeeee/888888?text=No+Image";
				const likesText = formatLikes(data.likes_raw);
				
				html += `
<a href="${data.url}" target="_blank" rel="noopener noreferrer" class="preview-card">
	<div class="card-content">
		<div class="status-label"></div>
		<div class="image-wrapper">
			<img src="${imageSrc}" alt="Preview Image">
			<div class="counter-circle">${index + 1}</div>
		</div>
		<div class="text-content">
			<p class="likes">${data.likes_hidden ? "🖤 Hidden" : formatLikes(data.likes_raw)}</p>

			<p class="username">${data.username || 'N/A'}</p>
			<p class="description-text">${data.title || 'No Title'}</p>
			<div class="copy-btn-wrapper">
				<button class="copy-btn" data-url="${data.url}">Copy🔗</button>
				<button class="refresh-btn" data-url="${data.url}" data-note="${noteKey}">
					<span>🔃Refresh</span>
				</button>			
				<button class="delete-btn" data-url="${data.url}">🗑️</button>
			</div>
		</div>
	</div>
</a>`;
			});

			html += `</div></div>`;
			el.innerHTML = html;

			// Save reference to last rendered preview
			this.lastRenderedEl = el;

			this.rebindAllButtons(el, ctx.sourcePath, source);

			this.htmlCache.set(blockKey, html);
		});

		this.registerEvent(
	this.app.vault.on("modify", async (file) => {
		if (!file || !file.path.endsWith(".md")) return;

		const content = await this.app.vault.read(file);
		const matches = content.match(/```instagram\s*([\s\S]*?)```/g);
		if (!matches) return;

		for (const block of matches) {
			const raw = block.replace(/```instagram|```/g, "").trim();
			const urls = raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
			const noteKey = file.path;

			for (const url of urls) {
				const tempKey = `${noteKey}:${url}`;
				const alreadyPersisted = this.persistentCache[noteKey]?.[url];

				if (this.tempPreviewCache.has(tempKey)) {
					const data = this.tempPreviewCache.get(tempKey);

					if (!this.persistentCache[noteKey]) this.persistentCache[noteKey] = {};
					this.persistentCache[noteKey][url] = data;
					this.responseCache.set(url, data);

					await this.saveData({ persistentCache: this.persistentCache });
					console.log(`✅ Restored from temp cache (Live Preview): ${url}`);
				}
			}
		}
	})
);


		this.loadStyles();
	}

	rebindAllButtons(el, noteKey, content) {
		this.rebindCopyButtons(el);
		this.rebindDeleteButtons(el, noteKey, content);
		this.rebindRefreshButtons(el, noteKey);
		this.rebindRefreshAllButton(el, noteKey);
		this.rebindDeleteAllButton(el, noteKey, content);

		this.rebindUndoRedoButtons(el);
	}

	rebindCopyButtons(el) {
		el.querySelectorAll(".copy-btn").forEach(btn => {
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				const url = btn.getAttribute("data-url");
				navigator.clipboard.writeText(url).then(() => {
					btn.innerText = "Copied!";
					btn.disabled = true;
					setTimeout(() => {
						btn.innerText = "Copy🔗";
						btn.disabled = false;
					}, 1500);
				});
			});
		});
	}

	rebindDeleteButtons(el, noteKey, content) {
		el.querySelectorAll(".delete-btn").forEach(btn => {
			btn.addEventListener("click", async (e) => {
				e.preventDefault();
				e.stopPropagation();

				const urlToDelete = btn.getAttribute("data-url");
				const file = this.app.workspace.getActiveFile();
				if (!file) return;

				const originalContent = await this.app.vault.read(file);
				const updatedContent = originalContent.replace(/```instagram\s*([\s\S]*?)```/g, (match, urlsBlock) => { 
					const updatedUrls = urlsBlock
						.split(/\s+/)
						.map(s => s.trim())
						.filter(u => u && u !== urlToDelete);
					return updatedUrls.length ? `\`\`\`instagram\n${updatedUrls.join("\n")}\n\`\`\`` : '';
				});

				// Save undo step (after computing updatedContent)
				this.undoStack.push({
					file: file.path,
					oldContent: originalContent,
					newContent: updatedContent,
				});


				await this.app.vault.modify(file, updatedContent);

				this.undoStack[this.undoStack.length - 1].newContent = updatedContent;
				this.redoStack = []; // Clear redo stack on new action


				if (this.persistentCache[noteKey]) {
					const previewData = this.responseCache.get(urlToDelete);
					if (previewData) {
						const cacheKey = `${noteKey}:${urlToDelete}`;
						this.tempPreviewCache.set(cacheKey, previewData);
					}

					delete this.persistentCache[noteKey][urlToDelete];
					await this.saveData({ persistentCache: this.persistentCache });
				}

				this.responseCache.delete(urlToDelete);
				const blockKey = `${noteKey}:${hash(content)}`;
				this.htmlCache.delete(blockKey);
			});
		});
	}

	setStatusLabel(previewCard, text, type) {
		const label = previewCard.querySelector(".status-label");
		if (!label) return;
	
		label.textContent = text;
		label.style.display = "block";
		label.style.opacity = "1";
		label.style.background = type === "success" ? "rgba(0, 128, 0, 0.8)" : "rgba(220, 20, 60, 0.9)";
	
		// Only fade out success after 2 minutes
		if (type === "success") {
			clearTimeout(label._hideTimeout);
			label._hideTimeout = setTimeout(() => {
				label.style.opacity = "0"; // fade out
	
				// After fade duration (e.g., 500ms), hide it completely
				setTimeout(() => {
					label.style.display = "none";
				}, 500);
			}, 30 * 1000); // 2 minutes
		}
	}
	


rebindRefreshButtons(el, noteKey) {
	el.querySelectorAll(".refresh-btn").forEach(btn => {
		btn.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			const url = btn.getAttribute("data-url");
			const refreshEmoji = btn.querySelector("span");
			refreshEmoji.innerHTML = '<div class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;"></div>Refreshing...';

			try {
				const res = await fetch("http://localhost:8000/link-preview", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ url }),
				});

				if (!res.ok) throw new Error("Failed to refresh preview");

				const [data] = await res.json();

				this.responseCache.set(url, data);
				if (!this.persistentCache[noteKey]) this.persistentCache[noteKey] = {};
				this.persistentCache[noteKey][url] = data;
				await this.saveData({ persistentCache: this.persistentCache });

				const previewCard = btn.closest(".preview-card");
				if (previewCard) {
					previewCard.querySelector(".likes").textContent = formatLikes(data.likes_raw);
					previewCard.querySelector(".username").textContent = data.username || "N/A";
					previewCard.querySelector(".description-text").textContent = data.title || "No Title";
					previewCard.querySelector("img").src = data.img || "https://via.placeholder.com/300x300/eeeeee/888888?text=No+Image";
					this.setStatusLabel(previewCard, "Refresh successful!", "success");
				}

				refreshEmoji.innerHTML = "✅Refreshed!";
				setTimeout(() => refreshEmoji.innerHTML = "🔃Refresh", 1700);
			} catch (err) {
				console.error("Error refreshing preview:", err);
				const previewCard = btn.closest(".preview-card");
				if (previewCard) {
					this.setStatusLabel(previewCard, "Refresh failed!", "error");
				}
				refreshEmoji.innerHTML = "❌Error";
				setTimeout(() => refreshEmoji.innerHTML = "🔃Refresh", 1700);
			}
		});
	});
}


rebindRefreshAllButton(el, noteKey) {
	const btn = el.querySelector(".refresh-all-btn");
	if (!btn) return;

	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		e.stopPropagation();

		btn.disabled = true;
		btn.innerHTML = `<div class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;"></div> Refreshing...`;  // Show spinner with Refreshing...

		const previewCards = Array.from(el.querySelectorAll(".preview-card"));
		const fetchPromises = previewCards.map(async (card) => {
			const url = card.querySelector(".copy-btn")?.getAttribute("data-url");
			if (!url) return;

			const refreshBtn = card.querySelector(".refresh-btn span");
			if (refreshBtn) refreshBtn.innerHTML = `<div class="spinner"></div>`;

			try {
				const res = await fetch("http://localhost:8000/link-preview", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ url }),
				});
				if (!res.ok) throw new Error(`Failed to refresh ${url}`);

				const [data] = await res.json();

				this.responseCache.set(url, data);
				if (!this.persistentCache[noteKey]) this.persistentCache[noteKey] = {};
				this.persistentCache[noteKey][url] = data;

				const likesElem = card.querySelector(".likes");
				const userElem = card.querySelector(".username");
				const descElem = card.querySelector(".description-text");
				const imgElem = card.querySelector("img");

				if (likesElem) likesElem.textContent = formatLikes(data.likes_raw);
				if (userElem) userElem.textContent = data.username || "N/A";
				if (descElem) descElem.textContent = data.title || "No Title";
				if (imgElem) imgElem.src = data.img || "https://via.placeholder.com/300x300/eeeeee/888888?text=No+Image";

				this.setStatusLabel(card, "Refresh successful!", "success");

				if (refreshBtn) {
					refreshBtn.textContent = "✅";
					setTimeout(() => (refreshBtn.textContent = "🔃"), 2000);
				}
			} catch (err) {
				console.error(`Error refreshing ${url}:`, err);
				this.setStatusLabel(card, "Refresh failed!", "error");
				if (refreshBtn) {
					refreshBtn.textContent = "❌";
					refreshBtn.title = "Refresh failed";
					setTimeout(() => (refreshBtn.textContent = "🔃"), 3000);
				}
			}
		});

		await Promise.all(fetchPromises); // Fetch all in parallel
		await this.saveData({ persistentCache: this.persistentCache });

		btn.innerHTML = "✅Refreshed!";
		setTimeout(() => {
			btn.innerHTML = "🔁 Refresh All";
			btn.disabled = false;
		}, 5000);
	});
}

rebindDeleteAllButton(el, noteKey, content) {
	const btn = el.querySelector(".delete-all-btn");
	if (!btn) return;

	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		e.stopPropagation();

		const confirmed = window.confirm("Are you sure you want to delete all the previews and their respective URLs?");
		if (!confirmed) return;

		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const originalContent = await this.app.vault.read(file);
		this.undoStack.push({
			file: file.path,
			oldContent: originalContent,
			newContent: null,
		});		
		const updatedContent = originalContent.replace(/```instagram\s*([\s\S]*?)```/g, '');

		await this.app.vault.modify(file, updatedContent);
		this.undoStack[this.undoStack.length - 1].newContent = updatedContent;
		this.redoStack = [];


		// Clear all cached data for the note
		if (this.persistentCache[noteKey]) {
			const urls = Object.keys(this.persistentCache[noteKey]);
			for (const url of urls) {
				this.responseCache.delete(url);
			}
			delete this.persistentCache[noteKey];
			await this.saveData({ persistentCache: this.persistentCache });
		}

		this.htmlCache.clear(); // Clear all rendered previews
	});
}

rebindUndoRedoButtons(el) {
	const undoBtn = el.querySelector(".undo-btn");
	const redoBtn = el.querySelector(".redo-btn");

	if (undoBtn) {
		undoBtn.addEventListener("click", () => {
			this.undoAction();
		});
	}

	if (redoBtn) {
		redoBtn.addEventListener("click", () => {
			this.redoAction();
		});
	}

	this.updateUndoRedoButtons(el);
}


updateUndoRedoButtons(el) {
	const undoBtn = el.querySelector(".undo-btn");
	const redoBtn = el.querySelector(".redo-btn");

	if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
	if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
}






	
	loadStyles() {
		const style = document.createElement("style");
		style.textContent = `

a:link {
	text-decoration: none;
}
a:hover {
	text-decoration: none;
}

.preview-wrapper {
	max-width: 1200px;
	margin: 0 auto;
}

.preview-container {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));

	gap: 16px;
	margin-top: 12px;
	padding: 1rem;
}

@media (min-width: 800px) {
	.preview-container {
		grid-template-columns: repeat(2, 1fr);
	}
}

.instagram-controls {
	display: flex;
	gap: .7rem;
}

.instagram-controls button {
	background-color: var(--interactive-accent);
	color: white;
	border: none;
	padding: 4px 8px;
	border-radius: 4px;
	cursor: pointer;
}

.instagram-controls button:hover {
  background-color: var(--interactive-accent-hover);
}

.instagram-controls button:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}


.preview-card {
	display: flex;
	flex-direction: row;
	align-items: flex-start;
	gap: 16px;
	padding: 16px;
	border: 1px solid #ccc;
	border-radius: 10px;
	box-shadow: 0px 2px 8px rgba(0,0,0,0.1);
	background-color: white;
	width: 100%;
	box-sizing: border-box;
	transition: transform 0.3s ease, box-shadow 0.3s ease;
	color: inherit;
}

.preview-card:hover {
	box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.preview-card:hover img {
	transform: scale(1.1);
}

.card-content {
	display: flex;
	flex-direction: row;
	gap: 16px;
	width: 100%;
}

.status-label {
	position: absolute;
	top: 8px;
	right: 8px;
	background: rgba(0, 128, 0, 0.8); /* green for success, red for failure */
	color: white;
	padding: 4px 8px;
	border-radius: 4px;
	font-size: 12px;
	display: none; /* initially hidden */
	z-index: 10;
	transition: opacity 0.5s ease;
  	opacity: 1;
}

.preview-card {
	position: relative; /* to position the label absolutely */
}

.image-wrapper {
	position: relative;
	width: 150px;
	height: 150px;
	overflow: hidden;
	flex-shrink: 0;
	border-radius: 12px;
}
.image-wrapper img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	transform: scale(1);
	transition: transform 0.3s ease;
	display: block;
}
.counter-circle {
	position: absolute;
	top: 8px;
	left: 8px;
	background: rgba(0, 0, 0, 0.4);
	color: #fff;
	width: 28px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	border-radius: 50%;
	backdrop-filter: blur(4px);
}
.text-content {
	flex-grow: 1;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: flex-start;
}
.text-content p {
	margin: 0;
}
.likes {
	font-size: 16px;
	font-weight: 700;
}
.username {
	font-size: 14px;
	font-weight: 700;
	margin: 4px 0;
	color: black;
}
.description-text {
	overflow: hidden;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	text-overflow: ellipsis;
	line-height: 1.4em;
	max-height: 2.8em;
	margin-top: 4px;
	color: #656565;
	font-size: 0.95em;
	word-break: break-word;
}

.refresh-all-btn-wrapper {
	text-align:right; 

	margin-top: 8px; 
	display: flex; 
	justify-content: space-around;
	padding: 0rem 1rem;
}

button.delete-all-btn {
	background: rgba(220, 20, 60, 0.9);
	color: white;
	font-weight: 900;
}

button.delete-all-btn:hover {
	background-color:rgb(193, 0, 0);
}

.copy-btn-wrapper {
	display: flex;
	gap: 6px;
	justify-content: flex-start;
	align-items: flex-start;
	width: 100%;
}
.copy-btn, .delete-btn, .refresh-btn, .refresh-all-btn, .delete-all-btn,.undo-btn, .redo-btn, .refresh-btn:hover {
	margin-top: 6px;
	padding: 6px 10px;
	font-size: 12px;
	border: none;
	border-radius: 6px;
	background-color: #e0e0e0;
	cursor: pointer;
	transition: background-color 0.2s ease;
}
.copy-btn:hover, .delete-btn:hover, .refresh-all-btn:hover, .delete-all-btn:hover {
	background-color: #d5d5d5;

}
	
@keyframes spinner {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top: 4px solid #333;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  animation: spinner 1s linear infinite;
}




`;
document.head.appendChild(style);
}

onunload() {
	console.log("Instagram Preview Plugin unloaded");
}
};

function formatLikes(likes) {
if (likes === null || likes === undefined || likes === "N/A") return "🖤 Hidden";
if (typeof likes === "string" && likes.includes("🖤")) return likes;
likes = Number(likes);
if (isNaN(likes)) return "🖤 Hidden";
if (likes === 0) return "❤️ 0";


if (likes >= 1_000_000) return `❤️ ${(likes / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
if (likes >= 1_000) return `❤️ ${(likes / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
return `❤️ ${likes}`;
}

function hash(str) {
let h = 0;
for (let i = 0; i < str.length; i++) {
	h = (h << 5) - h + str.charCodeAt(i);
	h |= 0;
}
return h;
}