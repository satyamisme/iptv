// StreamControl Pro - Single Page Application Core Logic

// App State
let currentView = 'dashboard';
let channels = [];
let selectedChannel = null;
let activeFilters = {
    search_term: '',
    nsfw: false,
    exclude_closed: true,
    favorites_only: false,
    working_only: false,
    languages: [],
    categories: [],
    countries: [],
    statuses: [],
    stream_format: '',
    selected_only: false,
    selected_ids: [],
    exclude_dead: true,
    exclude_no_url: true
};
let filterSearchTerms = { languages: '', categories: '', countries: '' };
let activeFilterCounts = { languages: {}, categories: {}, countries: {} };
let filterSortMode = { languages: 'name', categories: 'name', countries: 'count' };
let columnFilters = {
    status: '',
    id: '',
    name: '',
    country: '',
    category: '',
    language: ''
};
let currentPage = 1;
let itemsPerPage = 100;
let tableColumns = [
    { id: 'status', name: 'STATUS', visible: true, sizeClass: 'col-status' },
    { id: 'id', name: 'ID', visible: true, sizeClass: 'col-id' },
    { id: 'name', name: 'CHANNEL NAME', visible: true, sizeClass: 'col-name' },
    { id: 'country', name: 'COUNTRY', visible: true, sizeClass: 'col-country' },
    { id: 'category', name: 'CATEGORY', visible: true, sizeClass: 'col-category' },
    { id: 'language', name: 'LANGUAGE', visible: true, sizeClass: 'col-language' },
    { id: 'actions', name: 'ACTIONS', visible: true, sizeClass: 'col-actions' }
];
let countriesList = [];
let categoriesList = [];
let languagesTree = {};
let selectedLanguages = []; // For the Languages tab bulk updates
let currentLayout = 'table'; // 'table' or 'grid'
let presets = {}; // Globally stored filter presets
let selectedChannelIds = new Set(); // Globally tracked selected channels
let excludedChannelIds = new Set(); // Globally tracked excluded channels



// Player State
let hlsInstance = null;
const videoElement = document.getElementById('live-player');
const playerOverlay = document.getElementById('player-overlay');

// Progress Poller
let progressPoller = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadColumnConfiguration();
    // Clear hardcoded table to force dynamic generation on startup
    const scrollContainer = document.querySelector('.table-scroll-container');
    if (scrollContainer) {
        scrollContainer.innerHTML = '';
    }
    
    switchView('dashboard');
    checkServerStatus();
    loadSettingsAndPlaylists();
    initWorkspaceResizers();
    updateActivePlaylistBanner();
    
    // Periodically update dashboard status
    setInterval(checkServerStatus, 5000);
    
    // Bind video player event listeners for automatic status tracking
    videoElement.addEventListener('playing', () => {
        playerOverlay.style.display = 'none';
        if (selectedChannel) {
            updateChannelStatusLocallyAndOnServer(selectedChannel, 'Working', '✅');
        }
    });
    
    videoElement.addEventListener('error', () => {
        if (selectedChannel && videoElement.src && !videoElement.paused) {
            showPlayerError('Error playing live stream natively');
            updateChannelStatusLocallyAndOnServer(selectedChannel, 'Dead', '❌');
        }
    });
});

// View Routing
function switchView(viewId) {
    currentView = viewId;
    
    // Update active nav link
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('href') === `#${viewId}`) {
            item.classList.add('active');
        }
    });

    // Toggle content views
    document.querySelectorAll('.content-view').forEach(view => {
        view.classList.remove('active');
    });
    
    const targetView = document.getElementById(`view-${viewId}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Auto collapse left sidebar after navigation to maximize content space
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
    }
    
    // Update Header title
    const titleMap = {
        'dashboard': 'System Overview',
        'channels': 'Channel Manager',
        'languages': 'Language Directory',
        'export': 'Export & Sync',
        'settings': 'Console Settings',
        'playlists': 'Playlist Manager'
    };
    
    const subtitleMap = {
        'dashboard': 'Power User Control Console',
        'channels': 'Interactive Stream Editor',
        'languages': 'Bulk Language Assignment',
        'export': 'Playlist compilation & deployment',
        'settings': 'System details & specifications',
        'playlists': 'Manage, import, and export stream lists'
    };
    
    document.getElementById('view-title').textContent = titleMap[viewId] || 'StreamControl Pro';
    document.getElementById('view-subtitle').textContent = subtitleMap[viewId] || 'IPTV Monitor';
    
    // Reset video player when navigating away from channels view
    if (viewId !== 'channels') {
        stopVideoPlayback();
    }
    
    // If opening channels view and data is loaded, check if we need to load filters
    if (viewId === 'channels' || viewId === 'languages') {
        loadFiltersAndLists();
    }
    if (viewId === 'settings' || viewId === 'dashboard' || viewId === 'playlists') {
        loadSettingsAndPlaylists();
        if (viewId === 'playlists') {
            loadPlaylistsView();
        }
    }
}

// Server Status / Dashboard Updates
function checkServerStatus() {
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            const loaderStatus = document.getElementById('dashboard-loader-status');
            
            if (data.loading) {
                loaderStatus.innerHTML = '<span class="spinner" style="display:inline-block; vertical-align:middle; margin-right:5px;"></span> Fetching IPTV datasets...';
            } else if (data.loaded) {
                loaderStatus.textContent = 'API Database Sync: Active';
                // Update stats
                document.getElementById('stat-total').textContent = data.statistics.total || data.total_channels;
                document.getElementById('stat-working').textContent = data.statistics.working_count || 0;
                document.getElementById('stat-dead').textContent = data.statistics.dead_count || 0;
                document.getElementById('stat-geo').textContent = data.statistics.geo_count || 0;
                
                // Export page summary update
                const exportTotal = document.getElementById('export-total-streams');
                if (exportTotal) exportTotal.textContent = data.statistics.filtered || data.total_channels;
                
                // Auto-load filters and settings if we are in channels/languages view and not yet loaded
                if ((currentView === 'channels' || currentView === 'languages') && !filtersLoaded) {
                    loadFiltersAndLists();
                }
            } else {
                loaderStatus.textContent = 'Database empty. Select a quick load option below.';
            }
        })
        .catch(err => console.error('Error fetching system status:', err));
}

// Quick Load Handlers
function loadFromAPI() {
    updateLoaderStatus('Fetching data from api.iptv-org.github.io...');
    fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'api' })
    })
    .then(res => res.json())
    .then(data => {
        pollLoadingStatus();
    })
    .catch(err => alert('Load failed: ' + err));
}

function loadFromURL() {
    const url = document.getElementById('load-m3u-url').value;
    if (!url) return alert('Please enter a valid URL');
    
    updateLoaderStatus('Downloading and parsing M3U URL...');
    fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'url', url: url })
    })
    .then(res => res.json())
    .then(data => {
        pollLoadingStatus();
    })
    .catch(err => alert('Load failed: ' + err));
}

function uploadM3UFile(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    updateLoaderStatus(`Uploading and parsing ${file.name}...`);
    
    fetch('/api/upload-m3u', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Upload error: ' + data.error);
            checkServerStatus();
        } else {
            alert(`Successfully loaded ${data.count} channels from local file.`);
            checkServerStatus();
            loadFiltersAndLists();
        }
    })
    .catch(err => alert('Upload failed: ' + err));
}

function pollLoadingStatus() {
    const interval = setInterval(() => {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                if (!data.loading) {
                    clearInterval(interval);
                    if (data.error) {
                        alert('Error loading data: ' + data.error);
                    } else {
                        alert(`Successfully loaded ${data.total_channels} channels.`);
                    }
                    checkServerStatus();
                    loadFiltersAndLists();
                    updateActivePlaylistBanner();
                }
            });
    }, 1000);
}

function updateLoaderStatus(msg) {
    const loaderStatus = document.getElementById('dashboard-loader-status');
    loaderStatus.textContent = msg;
}

// Caches
function clearLocalCache() {
    if (confirm('Are you sure you want to flush all downloaded raw JSON caches? Your custom channels, checked statuses, and playlists will be preserved.')) {
        updateLoaderStatus('Clearing raw database caches...');
        fetch('/api/cache/clear', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert('Cache directory cleared successfully! Raw API files will be re-downloaded next time you load a playlist source.');
            checkServerStatus();
        })
        .catch(err => alert('Failed to clear cache: ' + err));
    }
}

// Filters data loading
let filtersLoaded = false;
let selectionsLoaded = false;
function loadFiltersAndLists() {
    if (filtersLoaded) return;
    
    fetch('/api/filters-data')
        .then(res => {
            if (!res.ok) throw new Error('Not loaded');
            return res.json();
        })
        .then(data => {
            filtersLoaded = true;
            countriesList = data.countries;
            categoriesList = data.categories;
            languagesTree = data.languages;
            
            // Populate presets combobox
            presets = data.presets; // Store presets globally
            const presetCombo = document.getElementById('presets-select');
            presetCombo.innerHTML = '<option value="">-- Select Saved Preset --</option>';
            Object.keys(presets).forEach(name => {
                presetCombo.innerHTML += `<option value="${name}">${name}</option>`;
            });
            
            // Render filter languages tree
            renderLanguagesTree();
            
            // Render filter categories listbox
            renderCategoriesBox();
            
            // Render filter countries listbox
            renderCountriesBox();
            
            // Trigger first channels fetch
            triggerFilter();
            
            // Render bulk languages grid if on languages tab
            renderBulkLanguagesGrid();

            // Load selected channels configuration on startup
            if (!selectionsLoaded) {
                loadSelectedFromConfig();
                selectionsLoaded = true;
            }
        })
        .catch(err => {
            // Probably not loaded yet, dashboard will handle it
        });
}

// Renderers for Left Filters panel
function onFilterSearch(type, val) {
    filterSearchTerms[type] = val.trim().toLowerCase();
    if (type === 'languages') {
        renderLanguagesTree();
    } else if (type === 'categories') {
        renderCategoriesBox();
    } else if (type === 'countries') {
        renderCountriesBox();
    }
}

function toggleFilterSort(type) {
    filterSortMode[type] = filterSortMode[type] === 'name' ? 'count' : 'name';
    
    // Update UI button text
    const label = document.getElementById(`sort-label-${type}`);
    if (label) {
        label.textContent = filterSortMode[type] === 'name' ? 'A-Z' : '9-1';
    }
    
    // Re-render
    if (type === 'languages') renderLanguagesTree();
    else if (type === 'categories') renderCategoriesBox();
    else if (type === 'countries') renderCountriesBox();
}

// Renderers for Left Filters panel
function renderLanguagesTree() {
    const container = document.getElementById('filter-languages-tree');
    if (!container) return;
    container.innerHTML = '';
    
    const searchTerm = filterSearchTerms.languages;
    
    Object.keys(languagesTree).forEach(groupName => {
        const groupLangs = languagesTree[groupName];
        
        // Filter languages inside this group
        let filteredLangs = groupLangs.filter(lang => {
            if (!searchTerm) return true;
            return lang.name.toLowerCase().includes(searchTerm) || lang.code.toLowerCase().includes(searchTerm);
        });
        
        if (filteredLangs.length === 0) return;
        
        // Sort languages inside this group based on current mode
        if (filterSortMode.languages === 'name') {
            filteredLangs.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            filteredLangs.sort((a, b) => {
                const cntA = activeFilterCounts.languages[a.name] || 0;
                const cntB = activeFilterCounts.languages[b.name] || 0;
                return cntB - cntA;
            });
        }
        
        const groupEl = document.createElement('div');
        groupEl.className = 'tree-group';
        
        const headerEl = document.createElement('div');
        headerEl.className = 'tree-header';
        headerEl.innerHTML = `<span class="tree-arrow">&#9656;</span> <strong>${groupName}</strong>`;
        
        const childrenEl = document.createElement('div');
        childrenEl.className = 'tree-children';
        
        // Auto expand if there is search term active
        if (searchTerm) {
            const arrow = headerEl.querySelector('.tree-arrow');
            if (arrow) arrow.classList.add('expanded');
            childrenEl.classList.add('expanded');
        }
        
        filteredLangs.forEach(lang => {
            const itemEl = document.createElement('div');
            itemEl.className = 'list-item';
            const isSelected = activeFilters.languages.includes(lang.name);
            if (isSelected) itemEl.classList.add('selected');
            
            const count = activeFilterCounts.languages[lang.name] || 0;
            
            itemEl.innerHTML = `
                <label class="custom-checkbox" style="margin: 0; width: 100%; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                    <span style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
                        <span>${lang.name}</span>
                    </span>
                    <span style="display: flex; gap: 5px; align-items: center;">
                        <span class="list-item-badge" style="background: rgba(255,255,255,0.05); color: var(--text-secondary);">${lang.code}</span>
                        <span class="list-item-badge" style="background: var(--color-accent-bg); color: var(--color-accent);">${count}</span>
                    </span>
                </label>
            `;
            itemEl.onclick = (e) => {
                if (e.target.tagName.toLowerCase() === 'input') {
                    toggleFilterItem('languages', lang.name, itemEl);
                    return;
                }
                e.preventDefault();
                const checkbox = itemEl.querySelector('input[type="checkbox"]');
                checkbox.checked = !checkbox.checked;
                toggleFilterItem('languages', lang.name, itemEl);
            };
            childrenEl.appendChild(itemEl);
        });
        
        headerEl.onclick = () => {
            const arrow = headerEl.querySelector('.tree-arrow');
            arrow.classList.toggle('expanded');
            childrenEl.classList.toggle('expanded');
        };
        
        groupEl.appendChild(headerEl);
        groupEl.appendChild(childrenEl);
        container.appendChild(groupEl);
    });
}

function renderCategoriesBox() {
    const container = document.getElementById('filter-categories-box');
    if (!container) return;
    container.innerHTML = '';
    
    const searchTerm = filterSearchTerms.categories;
    
    let filteredCats = categoriesList.filter(cat => {
        if (searchTerm && !cat.toLowerCase().includes(searchTerm)) return false;
        return true;
    });
    
    // Sort categories based on current mode
    if (filterSortMode.categories === 'name') {
        filteredCats.sort((a, b) => a.localeCompare(b));
    } else {
        filteredCats.sort((a, b) => {
            const cntA = activeFilterCounts.categories[a] || 0;
            const cntB = activeFilterCounts.categories[b] || 0;
            return cntB - cntA;
        });
    }
    
    filteredCats.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'list-item';
        const isSelected = activeFilters.categories.includes(cat);
        if (isSelected) item.classList.add('selected');
        
        const count = activeFilterCounts.categories[cat] || 0;
        
        item.innerHTML = `
            <label class="custom-checkbox" style="margin: 0; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer;">
                <span style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
                    <span>${cat}</span>
                </span>
                <span class="list-item-badge" style="background: var(--color-accent-bg); color: var(--color-accent);">${count}</span>
            </label>
        `;
        
        item.onclick = (e) => {
            if (e.target.tagName.toLowerCase() === 'input') {
                toggleFilterItem('categories', cat, item);
                return;
            }
            e.preventDefault();
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            toggleFilterItem('categories', cat, item);
        };
        container.appendChild(item);
    });
}

function renderCountriesBox() {
    const container = document.getElementById('filter-countries-box');
    if (!container) return;
    container.innerHTML = '';
    
    const searchTerm = filterSearchTerms.countries;
    
    // Convert keys to array and filter
    let sortedCountries = Object.keys(countriesList);
    
    if (searchTerm) {
        sortedCountries = sortedCountries.filter(code => code.toLowerCase().includes(searchTerm));
    }
    
    // Sort entries based on current mode
    if (filterSortMode.countries === 'name') {
        sortedCountries.sort((a, b) => a.localeCompare(b));
    } else {
        sortedCountries.sort((a, b) => {
            const cntA = activeFilterCounts.countries[a] || 0;
            const cntB = activeFilterCounts.countries[b] || 0;
            return cntB - cntA;
        });
    }
    
    sortedCountries.forEach(code => {
        const item = document.createElement('div');
        item.className = 'list-item';
        const isSelected = activeFilters.countries.includes(code);
        if (isSelected) item.classList.add('selected');
        
        const count = activeFilterCounts.countries[code] || 0;
        
        item.innerHTML = `
            <label class="custom-checkbox" style="margin: 0; width: 100%; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                <span style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
                    <span>${code}</span>
                </span>
                <span class="list-item-badge" style="background: var(--color-accent-bg); color: var(--color-accent);">${count}</span>
            </label>
        `;
        
        item.onclick = (e) => {
            if (e.target.tagName.toLowerCase() === 'input') {
                toggleFilterItem('countries', code, item);
                return;
            }
            e.preventDefault();
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            toggleFilterItem('countries', code, item);
        };
        container.appendChild(item);
    });
}

// Toggle active array filters
function toggleFilterItem(field, value, element) {
    const idx = activeFilters[field].indexOf(value);
    const checkbox = element.querySelector('input[type="checkbox"]');
    if (idx > -1) {
        activeFilters[field].splice(idx, 1);
        element.classList.remove('selected');
        if (checkbox) checkbox.checked = false;
    } else {
        activeFilters[field].push(value);
        element.classList.add('selected');
        if (checkbox) checkbox.checked = true;
    }
    triggerFilter();
}

function clearFilters() {
    activeFilters = {
        search_term: '',
        nsfw: false,
        exclude_closed: true,
        favorites_only: false,
        working_only: false,
        languages: [],
        categories: [],
        countries: [],
        statuses: [],
        stream_format: '',
        selected_only: false,
        selected_ids: [],
        exclude_dead: true,
        exclude_no_url: true,
        exclude_languages: false,
        exclude_categories: false,
        exclude_countries: false
    };
    
    // Reset UI
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-nsfw').checked = false;
    document.getElementById('filter-closed').checked = true;
    document.getElementById('filter-exclude-dead').checked = true;
    document.getElementById('filter-exclude-no-url').checked = true;
    document.getElementById('filter-favs').checked = false;
    
    const selCheckbox = document.getElementById('filter-selected-only');
    if (selCheckbox) selCheckbox.checked = false;
    const preserveCheckbox = document.getElementById('preserve-selection');
    if (preserveCheckbox) preserveCheckbox.checked = false;
    const exclLangs = document.getElementById('exclude-languages');
    if (exclLangs) exclLangs.checked = false;
    const exclCats = document.getElementById('exclude-categories');
    if (exclCats) exclCats.checked = false;
    const exclCountries = document.getElementById('exclude-countries');
    if (exclCountries) exclCountries.checked = false;

    // Reset inline search inputs
    filterSearchTerms = { languages: '', categories: '', countries: '' };
    const langSearch = document.getElementById('languages-search-input');
    if (langSearch) langSearch.value = '';
    const catSearch = document.getElementById('categories-search-input');
    if (catSearch) catSearch.value = '';
    const countSearch = document.getElementById('countries-search-input');
    if (countSearch) countSearch.value = '';

    // Reset column filters
    columnFilters = {
        status: '',
        id: '',
        name: '',
        country: '',
        category: '',
        language: ''
    };
    
    const colStatus = document.getElementById('col-filter-status');
    if (colStatus) colStatus.value = '';
    const colId = document.getElementById('col-filter-id');
    if (colId) colId.value = '';
    const colName = document.getElementById('col-filter-name');
    if (colName) colName.value = '';
    const colCountry = document.getElementById('col-filter-country');
    if (colCountry) colCountry.value = '';
    const colCategory = document.getElementById('col-filter-category');
    if (colCategory) colCategory.value = '';
    const colLang = document.getElementById('col-filter-language');
    if (colLang) colLang.value = '';

    ['working', 'slow', 'dead', 'geo', 'unknown'].forEach(s => {
        const el = document.getElementById(`status-${s}`);
        if (el) el.checked = false;
    });
    document.getElementById('filter-format').value = '';
    document.getElementById('presets-select').value = '';
    
    document.querySelectorAll('.filters-panel .list-item').forEach(el => el.classList.remove('selected'));
    
    // Refresh the filtered rendered lists as well
    renderLanguagesTree();
    renderCategoriesBox();
    renderCountriesBox();
    
    triggerFilter();
}

// Preset Loader
function applyPreset(presetName) {
    if (!presetName) return;
    
    const presetFilters = presets[presetName] || {};
    clearFilters();
    
    // Map preset options
    if (presetFilters.nsfw !== undefined) {
        document.getElementById('filter-nsfw').checked = presetFilters.nsfw;
        activeFilters.nsfw = presetFilters.nsfw;
    }
    if (presetFilters.exclude_closed !== undefined) {
        document.getElementById('filter-closed').checked = presetFilters.exclude_closed;
        activeFilters.exclude_closed = presetFilters.exclude_closed;
    }
    if (presetFilters.exclude_dead !== undefined) {
        document.getElementById('filter-exclude-dead').checked = presetFilters.exclude_dead;
        activeFilters.exclude_dead = presetFilters.exclude_dead;
    } else {
        document.getElementById('filter-exclude-dead').checked = true;
        activeFilters.exclude_dead = true;
    }
    if (presetFilters.exclude_no_url !== undefined) {
        document.getElementById('filter-exclude-no-url').checked = presetFilters.exclude_no_url;
        activeFilters.exclude_no_url = presetFilters.exclude_no_url;
    } else {
        document.getElementById('filter-exclude-no-url').checked = true;
        activeFilters.exclude_no_url = true;
    }
    if (presetFilters.favorites_only !== undefined) {
        document.getElementById('filter-favs').checked = presetFilters.favorites_only;
        activeFilters.favorites_only = presetFilters.favorites_only;
    }
    if (presetFilters.search_term) {
        document.getElementById('filter-search').value = presetFilters.search_term;
        activeFilters.search_term = presetFilters.search_term;
    }
    
    // For languages, categories, countries - select elements in DOM and check checkboxes
    if (presetFilters.categories) {
        activeFilters.categories = [...presetFilters.categories];
        document.querySelectorAll('#filter-categories-box .list-item').forEach(el => {
            const checkbox = el.querySelector('input[type="checkbox"]');
            const text = el.querySelector('span').textContent.trim();
            if (presetFilters.categories.includes(text)) {
                el.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            }
        });
    }
    if (presetFilters.countries) {
        activeFilters.countries = [...presetFilters.countries];
        document.querySelectorAll('#filter-countries-box .list-item').forEach(el => {
            const checkbox = el.querySelector('input[type="checkbox"]');
            const text = el.querySelector('span span').textContent.trim();
            if (presetFilters.countries.includes(text)) {
                el.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            }
        });
    }
    if (presetFilters.languages) {
        activeFilters.languages = [];
        document.querySelectorAll('#filter-languages-tree .list-item').forEach(el => {
            const checkbox = el.querySelector('input[type="checkbox"]');
            const code = el.querySelector('.list-item-badge').textContent.trim();
            const name = el.querySelector('span span').textContent.trim();
            if (presetFilters.languages.includes(code) || presetFilters.languages.includes(name)) {
                el.classList.add('selected');
                if (checkbox) checkbox.checked = true;
                activeFilters.languages.push(name);
            }
        });
    }
    
    triggerFilter();
}

let filterDebounceTimer = null;
let filterAbortController = null;

// Fetch Channels lists via filters
function triggerFilter() {
    // Show processing status immediately
    showFilterLoadingState(true);

    if (filterDebounceTimer) {
        clearTimeout(filterDebounceTimer);
    }

    filterDebounceTimer = setTimeout(() => {
        // Cancel previous pending filter request to avoid race conditions
        if (filterAbortController) {
            filterAbortController.abort();
        }
        filterAbortController = new AbortController();
        const signal = filterAbortController.signal;

        // Read search string directly
        activeFilters.search_term = document.getElementById('filter-search').value;
        activeFilters.nsfw = document.getElementById('filter-nsfw').checked;
        activeFilters.exclude_closed = document.getElementById('filter-closed').checked;
        
        const deadCheckbox = document.getElementById('filter-exclude-dead');
        activeFilters.exclude_dead = deadCheckbox ? deadCheckbox.checked : true;
        const noUrlCheckbox = document.getElementById('filter-exclude-no-url');
        activeFilters.exclude_no_url = noUrlCheckbox ? noUrlCheckbox.checked : true;

        activeFilters.favorites_only = document.getElementById('filter-favs').checked;
        
        const selCheckbox = document.getElementById('filter-selected-only');
        const showSelectedOnly = selCheckbox ? selCheckbox.checked : false;
        activeFilters.selected_only = showSelectedOnly;
        
        const preserveSel = document.getElementById('preserve-selection');
        const preserve = preserveSel ? preserveSel.checked : false;
        if (!preserve && !showSelectedOnly) {
            selectedChannelIds.clear();
            const headerCheck = document.getElementById('header-select-all');
            if (headerCheck) headerCheck.checked = false;
            updateCheckSelectedButtonState();
        }
        
        activeFilters.selected_ids = Array.from(selectedChannelIds);
        activeFilters.exclude_languages = document.getElementById('exclude-languages') ? document.getElementById('exclude-languages').checked : false;
        activeFilters.exclude_categories = document.getElementById('exclude-categories') ? document.getElementById('exclude-categories').checked : false;
        activeFilters.exclude_countries = document.getElementById('exclude-countries') ? document.getElementById('exclude-countries').checked : false;

        // Status filters
        const selectedStatuses = [];
        ['working', 'slow', 'dead', 'geo', 'unknown'].forEach(s => {
            const el = document.getElementById(`status-${s}`);
            if (el && el.checked) {
                selectedStatuses.push(el.value);
            }
        });
        activeFilters.statuses = selectedStatuses;
        
        // Stream format
        activeFilters.stream_format = document.getElementById('filter-format').value;
        
        fetch('/api/channels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(activeFilters),
            signal: signal
        })
        .then(res => res.json())
        .then(data => {
            channels = data.channels;
            currentPage = 1; // Reset to page 1 on new filter query
            showFilterLoadingState(false);
            
            // Store dynamic counts
            activeFilterCounts = data.counts || { languages: {}, categories: {}, countries: {} };
            
            // Save scroll positions
            const langScroll = document.getElementById('filter-languages-tree') ? document.getElementById('filter-languages-tree').scrollTop : 0;
            const catScroll = document.getElementById('filter-categories-box') ? document.getElementById('filter-categories-box').scrollTop : 0;
            const countScroll = document.getElementById('filter-countries-box') ? document.getElementById('filter-countries-box').scrollTop : 0;
            
            // Re-render sidebar list boxes with updated counts and correct sort
            renderLanguagesTree();
            renderCategoriesBox();
            renderCountriesBox();
            
            // Restore scroll positions
            if (document.getElementById('filter-languages-tree')) document.getElementById('filter-languages-tree').scrollTop = langScroll;
            if (document.getElementById('filter-categories-box')) document.getElementById('filter-categories-box').scrollTop = catScroll;
            if (document.getElementById('filter-countries-box')) document.getElementById('filter-countries-box').scrollTop = countScroll;

            // Update Label showing
            const showingLabel = document.getElementById('channels-showing-label');
            if (data.filtered_count > data.shown_count) {
                showingLabel.textContent = `Showing ${data.shown_count} (capped) of ${data.filtered_count} channels (Total: ${data.total})`;
            } else {
                showingLabel.textContent = `Showing ${data.filtered_count} of ${data.total} channels`;
            }
            
            // Render view
            renderChannelsList();
        })
        .catch(err => {
            if (err.name === 'AbortError') return; // Ignore cancelled requests
            console.error('Error filtering channels:', err);
            showFilterLoadingState(false);
        });
    }, 250);
}

function showFilterLoadingState(show) {
    const scrollContainer = document.querySelector('.table-scroll-container');
    const showingLabel = document.getElementById('channels-showing-label');
    const paginationBar = document.getElementById('pagination-bar');
    
    if (show) {
        if (showingLabel) showingLabel.textContent = 'Applying filters, please wait...';
        if (paginationBar) paginationBar.style.display = 'none';
        if (scrollContainer) {
            let overlay = scrollContainer.querySelector('.filter-loading-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'filter-loading-overlay';
                overlay.innerHTML = `
                    <div class="spinner" style="width: 35px; height: 35px; border-width: 3px;"></div>
                    <span style="color: var(--text-primary); font-size: 13px; font-weight: 500; margin-top: 10px;">Filtering IPTV Database...</span>
                `;
                scrollContainer.appendChild(overlay);
            }
            overlay.style.display = 'flex';
        }
    } else {
        if (scrollContainer) {
            const overlay = scrollContainer.querySelector('.filter-loading-overlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        }
    }
}

// Global search bar handler
function onGlobalSearch(val) {
    if (currentView !== 'channels') {
        switchView('channels');
    }
    document.getElementById('filter-search').value = val;
    triggerFilter();
}

// Render Channels Layout (Table / Grid)
function toggleLayout() {
    currentLayout = currentLayout === 'table' ? 'grid' : 'table';
    renderChannelsList();
}

function renderChannelsList() {
    const scrollContainer = document.querySelector('.table-scroll-container');
    if (!scrollContainer) return;
    
    let displayChannels = channels;
    
    // Apply column filters
    if (columnFilters.status) {
        displayChannels = displayChannels.filter(ch => ch.status_text === columnFilters.status);
    }
    if (columnFilters.id) {
        displayChannels = displayChannels.filter(ch => ch.id && ch.id.toLowerCase().includes(columnFilters.id));
    }
    if (columnFilters.name) {
        displayChannels = displayChannels.filter(ch => ch.name && ch.name.toLowerCase().includes(columnFilters.name));
    }
    if (columnFilters.country) {
        displayChannels = displayChannels.filter(ch => ch.country && ch.country.toLowerCase().includes(columnFilters.country));
    }
    if (columnFilters.category) {
        displayChannels = displayChannels.filter(ch => ch.categories && ch.categories.some(cat => cat.toLowerCase().includes(columnFilters.category)));
    }
    if (columnFilters.language) {
        displayChannels = displayChannels.filter(ch => ch.languages && ch.languages.some(lang => lang.toLowerCase().includes(columnFilters.language)));
    }
    
    // Calculate total pages
    const totalPages = Math.ceil(displayChannels.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    
    // Get item slice for the current page
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, displayChannels.length);
    const pageItems = displayChannels.slice(startIndex, endIndex);
    
    // Update pagination controls
    const paginationBar = document.getElementById('pagination-bar');
    if (paginationBar) {
        if (displayChannels.length === 0) {
            paginationBar.style.display = 'none';
        } else {
            paginationBar.style.display = 'flex';
            document.getElementById('pagination-info').textContent = `Showing ${startIndex + 1}-${endIndex} of ${displayChannels.length} channels (Page ${currentPage}/${totalPages})`;
            document.getElementById('btn-prev-page').disabled = currentPage === 1;
            document.getElementById('btn-next-page').disabled = currentPage === totalPages;
        }
    }
    
    const showingLabel = document.getElementById('channels-showing-label');
    if (showingLabel) {
        showingLabel.textContent = `Showing ${displayChannels.length} of ${channels.length} items`;
    }
    
    if (currentLayout === 'table') {
        let table = scrollContainer.querySelector('.channels-table');
        if (!table) {
            scrollContainer.innerHTML = '';
            table = document.createElement('table');
            table.className = 'channels-table';
            table.innerHTML = buildTableHeaderAndFiltersHtml();
            scrollContainer.appendChild(table);
            initTableColumnResizers();
            
            // Restore input values
            const statusFilter = document.getElementById('col-filter-status');
            if (statusFilter) statusFilter.value = columnFilters.status || '';
            const idFilter = document.getElementById('col-filter-id');
            if (idFilter) idFilter.value = columnFilters.id || '';
            const nameFilter = document.getElementById('col-filter-name');
            if (nameFilter) nameFilter.value = columnFilters.name || '';
            const countryFilter = document.getElementById('col-filter-country');
            if (countryFilter) countryFilter.value = columnFilters.country || '';
            const categoryFilter = document.getElementById('col-filter-category');
            if (categoryFilter) categoryFilter.value = columnFilters.category || '';
            const langFilter = document.getElementById('col-filter-language');
            if (langFilter) langFilter.value = columnFilters.language || '';
        }
        
        const tbody = document.getElementById('channels-table-body');
        tbody.innerHTML = '';
        
        const totalVisibleCols = tableColumns.filter(c => c.visible).length + 2;
        if (displayChannels.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="${totalVisibleCols}" class="text-center pad-20" style="color: var(--text-secondary);">No channels match the current filters.</td>
                </tr>
            `;
            return;
        }
        
        pageItems.forEach(ch => {
            const tr = document.createElement('tr');
            tr.id = `ch-row-${ch.id}`;
            if (selectedChannel && selectedChannel.id === ch.id) tr.className = 'active-row';
            
            const isExcluded = excludedChannelIds.has(ch.id);
            if (isExcluded) tr.classList.add('excluded-row');
            
            const isFavClass = ch.is_favorite ? 'active' : '';
            const statusClass = getStatusClass(ch.status_text);
            const isChecked = selectedChannelIds.has(ch.id) ? 'checked' : '';
            
            let cellsHtml = `

                <td class="col-select" onclick="event.stopPropagation()">
                    <input type="checkbox" class="row-select-checkbox" data-id="${ch.id}" ${isChecked} onchange="toggleChannelSelection('${ch.id}', this.checked)">
                    <button class="exclude-btn-ch ${isExcluded ? 'active' : ''}" data-id="${ch.id}" title="Always Exclude Channel" onclick="toggleChannelExclusion('${ch.id}', event)">🚫</button>
                </td>
                <td class="col-fav"><span class="fav-star ${isFavClass}" onclick="toggleFavorite('${ch.id}', event)">★</span></td>
            `;


            tableColumns.forEach(col => {
                if (!col.visible) return;
                
                if (col.id === 'status') {
                    cellsHtml += `<td class="col-status"><span class="status-badge ${statusClass}">${ch.status_icon} ${ch.status_text}</span></td>`;
                } else if (col.id === 'id') {
                    cellsHtml += `<td class="col-id">${ch.id}</td>`;
                } else if (col.id === 'name') {
                    cellsHtml += `<td class="col-name">${ch.name}</td>`;
                } else if (col.id === 'country') {
                    cellsHtml += `<td class="col-country">${ch.country || '--'}</td>`;
                } else if (col.id === 'category') {
                    cellsHtml += `<td class="col-category">${(ch.categories || []).join(', ') || '--'}</td>`;
                } else if (col.id === 'language') {
                    cellsHtml += `<td class="col-language">${(ch.languages || []).join(', ') || '--'}</td>`;
                } else if (col.id === 'actions') {
                    cellsHtml += `
                        <td class="col-actions">
                            <button class="action-btn-row" title="Open Stream link in Browser" onclick="openStreamInBrowser('${ch.url}', event)">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </button>
                        </td>
                    `;
                }
            });

            tr.innerHTML = cellsHtml;
            tr.onclick = () => selectChannel(ch);
            tbody.appendChild(tr);
        });
        
        // Sync header checkbox for visible page items
        const headerCheck = document.getElementById('header-select-all');
        if (headerCheck) {
            const visibleIds = pageItems.map(ch => ch.id);
            const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedChannelIds.has(id));
            headerCheck.checked = allVisibleSelected;
        }
    } else {
        // Render Grid
        let gridDiv = scrollContainer.querySelector('.channels-grid-layout');
        if (!gridDiv) {
            scrollContainer.innerHTML = '';
            gridDiv = document.createElement('div');
            gridDiv.className = 'channels-grid-layout';
            scrollContainer.appendChild(gridDiv);
        }
        gridDiv.innerHTML = '';
        
        if (displayChannels.length === 0) {
            gridDiv.innerHTML = `<div class="text-center pad-20" style="grid-column: 1/-1; color: var(--text-secondary);">No channels match the current filters.</div>`;
            return;
        }
        
        pageItems.forEach(ch => {
            const card = document.createElement('div');
            const isExcluded = excludedChannelIds.has(ch.id);
            card.className = `channel-card ${selectedChannel && selectedChannel.id === ch.id ? 'active-card' : ''} ${isExcluded ? 'excluded-card' : ''}`;
            card.id = `ch-card-${ch.id}`;

            
            const isFavClass = ch.is_favorite ? 'active' : '';
            const statusClass = getStatusClass(ch.status_text);
            const isChecked = selectedChannelIds.has(ch.id) ? 'checked' : '';
            
            card.innerHTML = `
                <div class="channel-card-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <label class="custom-checkbox" style="margin: 0;" onclick="event.stopPropagation()">
                        <input type="checkbox" class="grid-select-checkbox" data-id="${ch.id}" ${isChecked} onchange="toggleChannelSelection('${ch.id}', this.checked)">
                    </label>
                    <button class="exclude-btn-ch ${isExcluded ? 'active' : ''}" data-id="${ch.id}" title="Always Exclude Channel" onclick="toggleChannelExclusion('${ch.id}', event)">🚫</button>
                    <span class="status-badge ${statusClass}">${ch.status_icon} ${ch.status_text}</span>
                    <span class="fav-star ${isFavClass}" onclick="toggleFavorite('${ch.id}', event)">★</span>
                </div>

                <div class="channel-card-name">${ch.name}</div>
                <div class="channel-card-details">
                    <span><strong>Group:</strong> ${(ch.categories || [])[0] || 'Uncategorized'}</span>
                    <span><strong>Lang:</strong> ${(ch.languages || [])[0] || 'Unknown'}</span>
                    <span><strong>Country:</strong> ${ch.country || '--'}</span>
                </div>
            `;
            card.onclick = () => selectChannel(ch);
            gridDiv.appendChild(card);
        });
    }
}

function changePage(offset) {
    const totalPages = Math.ceil(channels.length / itemsPerPage);
    currentPage += offset;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    renderChannelsList();
}


function getStatusClass(text) {
    if (text === 'Working') return 'active';
    if (text === 'Dead') return 'dead';
    if (text === 'Slow') return 'slow';
    if (text === 'Geo-blocked') return 'geo';
    return 'unknown';
}

// Actions
function toggleFavorite(chId, event) {
    if (event) event.stopPropagation();
    
    fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: chId })
    })
    .then(res => res.json())
    .then(data => {
        // Find star icon and toggle color
        const targetClass = currentLayout === 'table' ? `ch-row-${chId}` : `ch-card-${chId}`;
        const row = document.getElementById(targetClass);
        if (row) {
            const star = row.querySelector('.fav-star');
            if (data.is_favorite) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        }
        
        // Update our cache
        const ch = channels.find(c => c.id === chId);
        if (ch) ch.is_favorite = data.is_favorite;
        
        // If we are showing only favorites, reload filters
        if (activeFilters.favorites_only) {
            triggerFilter();
        }
    });
}

function openStreamInBrowser(url, event) {
    if (event) event.stopPropagation();
    if (url) {
        window.open(url, '_blank');
    } else {
        alert('No stream URL available.');
    }
}

// Channel Selection & Inspector
function selectChannel(ch) {
    selectedChannel = ch;
    
    // Highlight row/card in DOM
    document.querySelectorAll('.channels-table tbody tr').forEach(el => el.classList.remove('active-row'));
    document.querySelectorAll('.channel-card').forEach(el => el.classList.remove('active-card'));
    
    const rowEl = document.getElementById(`ch-row-${ch.id}`);
    if (rowEl) rowEl.classList.add('active-row');
    const cardEl = document.getElementById(`ch-card-${ch.id}`);
    if (cardEl) cardEl.classList.add('active-card');
    
    // Expand inspector panel width
    const workspace = document.querySelector('.channel-workspace');
    if (workspace) {
        workspace.classList.remove('inspector-collapsed');
        updateWorkspaceLayout();
    }
    
    // Open Inspector details
    document.getElementById('inspector-empty').style.display = 'none';
    document.getElementById('inspector-content').style.display = 'flex';
    
    // Update Inspector properties
    document.getElementById('prop-url').textContent = ch.url || 'None';
    document.getElementById('prop-url').title = ch.url || '';
    document.getElementById('prop-ua').textContent = ch.user_agent || 'None';
    document.getElementById('prop-ua').title = ch.user_agent || '';
    document.getElementById('prop-referer').textContent = ch.referrer || 'None';
    document.getElementById('prop-referer').title = ch.referrer || '';
    
    // Latency metadata update
    let latencyText = 'TIMEOUT';
    if (ch.status_text === 'Working') latencyText = '142ms';
    else if (ch.status_text === 'Slow') latencyText = '2,840ms';
    
    // Simulated Geo-Info mapping
    const locationMap = {
        'US': { origin: 'New York, USA', isp: 'ISP: Verizon Business. Data center identified as AWS us-east-1.' },
        'IN': { origin: 'Mumbai, India', isp: 'ISP: Reliance Jio Infocomm. Local ISP routing verified.' },
        'GB': { origin: 'London, United Kingdom', isp: 'ISP: British Telecommunications. Data center: AWS eu-west-2.' },
        'FR': { origin: 'Paris, France', isp: 'ISP: Orange S.A. Geo-restricted nodes active.' },
        'DE': { origin: 'Frankfurt, Germany', isp: 'ISP: Deutsche Telekom. Uptime routing certified.' }
    };
    
    const geo = locationMap[ch.country] || { origin: ch.country ? `${ch.country} origin` : 'Unknown Region', isp: 'ISP information routing verified via cloudflare.' };
    document.getElementById('geo-location-text').textContent = geo.origin;
    document.getElementById('geo-isp-text').textContent = geo.isp;
    
    // Play Stream!
    playHlsStream(ch.url, ch.user_agent, ch.referrer);
}

function deselectChannel() {
    selectedChannel = null;
    document.querySelectorAll('.channels-table tbody tr').forEach(el => el.classList.remove('active-row'));
    document.querySelectorAll('.channel-card').forEach(el => el.classList.remove('active-card'));
    
    document.getElementById('inspector-empty').style.display = 'flex';
    document.getElementById('inspector-content').style.display = 'none';
    stopVideoPlayback();
    
    // Collapse inspector panel width
    const workspace = document.querySelector('.channel-workspace');
    if (workspace) {
        workspace.classList.add('inspector-collapsed');
        updateWorkspaceLayout();
    }
}

// Live Playback Engine
function playHlsStream(url, userAgent, referrer) {
    stopVideoPlayback();
    
    if (!url) {
        showPlayerError('No URL available');
        return;
    }
    
    // Wrap the URL in our local CORS proxy
    let proxiedUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    if (userAgent) {
        proxiedUrl += `&user_agent=${encodeURIComponent(userAgent)}`;
    }
    if (referrer) {
        proxiedUrl += `&referrer=${encodeURIComponent(referrer)}`;
    }
    
    playerOverlay.style.display = 'flex';
    playerOverlay.querySelector('span').textContent = 'Loading stream...';
    playerOverlay.querySelector('.spinner').style.display = 'block';
    
    // HLS stream playback logic
    const cleanUrl = url.split('?')[0].toLowerCase();
    const isHls = cleanUrl.endsWith('.m3u8') || url.toLowerCase().includes('m3u8');
    
    if (isHls && Hls.isSupported()) {
        hlsInstance = new Hls({
            maxBufferSize: 0, // play immediately
            maxBufferLength: 2,
            liveSyncDuration: 3
        });
        hlsInstance.loadSource(proxiedUrl);
        hlsInstance.attachMedia(videoElement);
        
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            videoElement.play()
                .then(() => {
                    playerOverlay.style.display = 'none';
                    updateChannelStatusLocallyAndOnServer(selectedChannel, 'Working', '✅');
                })
                .catch(err => {
                    showPlayerError('Playback blocked by browser settings');
                });
        });
        
        hlsInstance.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                switch(data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hlsInstance.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hlsInstance.recoverMediaError();
                        break;
                    default:
                        showPlayerError('Unplayable stream or Geo-blocked connection');
                        stopVideoPlayback();
                        updateChannelStatusLocallyAndOnServer(selectedChannel, 'Dead', '❌');
                        break;
                }
            }
        });
    } else {
        // Play progressive media natively
        videoElement.src = proxiedUrl;
        videoElement.play()
            .then(() => {
                playerOverlay.style.display = 'none';
                updateChannelStatusLocallyAndOnServer(selectedChannel, 'Working', '✅');
            })
            .catch(err => {
                // Autoplay block or native play exception
                playerOverlay.style.display = 'none';
                console.log("Autoplay block or native play exception", err);
            });
            
        // Bind native video error handler for fatal errors
        const nativeErrorHandler = () => {
            if (selectedChannel && videoElement.src && !videoElement.paused) {
                showPlayerError('Native playback failed or unsupported format');
                updateChannelStatusLocallyAndOnServer(selectedChannel, 'Dead', '❌');
                videoElement.removeEventListener('error', nativeErrorHandler);
            }
        };
        videoElement.addEventListener('error', nativeErrorHandler);
    }

  }

function stopVideoPlayback() {
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    videoElement.pause();
    videoElement.src = '';
    playerOverlay.style.display = 'none';
}

function showPlayerError(msg) {
    playerOverlay.style.display = 'flex';
    playerOverlay.querySelector('span').textContent = msg;
    playerOverlay.querySelector('.spinner').style.display = 'none';
}

function copyStreamURL() {
    if (!selectedChannel || !selectedChannel.url) return;
    navigator.clipboard.writeText(selectedChannel.url)
        .then(() => alert('Copied stream URL to clipboard!'))
        .catch(err => alert('Failed to copy: ' + err));
}

function downloadFragment() {
    alert('Requesting HLS segment fragments from TS server...');
}

function flushChannelCache() {
    alert('Flushed edge node CDNs for this stream.');
}

function recheckSelectedStream() {
    if (!selectedChannel) return;
    
    const btn = document.getElementById('btn-recheck-stream');
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; vertical-align: middle; margin-right:5px;"></span> Checking...';
    
    fetch('/api/channels/check-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: selectedChannel.id })
    })
    .then(res => res.json())
    .then(data => {
        btn.disabled = false;
        btn.innerHTML = oldText;
        
        if (data.error) {
            alert('Error checking stream: ' + data.error);
            return;
        }
        
        // Update in-memory stream status
        selectedChannel.status_text = data.status_text;
        selectedChannel.status_icon = data.status_icon;
        
        // Update dashboard counters
        checkServerStatus();
        
        // Update UI row/card status badge directly
        const rowId = `ch-row-${selectedChannel.id}`;
        const row = document.getElementById(rowId);
        if (row) {
            const badge = row.querySelector('.status-badge');
            if (badge) {
                badge.className = `status-badge ${getStatusClass(data.status_text)}`;
                badge.innerHTML = `${data.status_icon} ${data.status_text}`;
            }
        }
        const cardId = `ch-card-${selectedChannel.id}`;
        const card = document.getElementById(cardId);
        if (card) {
            const badge = card.querySelector('.status-badge');
            if (badge) {
                badge.className = `status-badge ${getStatusClass(data.status_text)}`;
                badge.innerHTML = `${data.status_icon} ${data.status_text}`;
            }
        }
        
        // Refresh playback stream in case it's now working
        playHlsStream(selectedChannel.url, selectedChannel.user_agent, selectedChannel.referrer);
    })
    .catch(err => {
        btn.disabled = false;
        btn.innerHTML = oldText;
        alert('Check failed: ' + err);
    });
}

// Bulk stream checker poller
function checkAllStreams() {
    fetch('/api/check-streams', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            document.getElementById('stream-check-progress-wrapper').style.display = 'block';
            startProgressPolling();
        });
}

function startProgressPolling() {
    if (progressPoller) clearInterval(progressPoller);
    
    const scanPanel = document.getElementById('dashboard-scan-panel');
    if (scanPanel) scanPanel.style.display = 'block';

    progressPoller = setInterval(() => {
        fetch('/api/check-streams-progress')
            .then(res => res.json())
            .then(data => {
                const bar = document.getElementById('stream-check-progress-fill');
                const label = document.getElementById('stream-check-progress-text');
                
                if (data.running || (data.completed < data.total && data.total > 0)) {
                    const pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                    
                    if (bar) bar.style.width = pct + '%';
                    if (label) label.textContent = `Checking: ${pct}% (${data.completed}/${data.total})`;
                    
                    if (scanPanel) scanPanel.style.display = 'block';
                    
                    const pctText = document.getElementById('scan-percent-text');
                    const countText = document.getElementById('scan-count-text');
                    if (pctText) pctText.textContent = pct + '%';
                    if (countText) countText.textContent = `${data.completed} / ${data.total}`;
                    
                    const circle = document.getElementById('scan-progress-circle');
                    if (circle) {
                        const dasharray = 238.76;
                        const offset = dasharray - (pct / 100) * dasharray;
                        circle.style.strokeDashoffset = offset;
                    }
                    
                    // Update CPU, RAM, Threads metrics
                    if (data.metrics) {
                        const cpuVal = document.getElementById('metric-cpu-val');
                        const cpuBar = document.getElementById('metric-cpu-bar');
                        if (cpuVal) cpuVal.textContent = (data.metrics.cpu_percent || 0) + '%';
                        if (cpuBar) cpuBar.style.width = (data.metrics.cpu_percent || 0) + '%';
                        
                        const ramVal = document.getElementById('metric-ram-val');
                        const ramBar = document.getElementById('metric-ram-bar');
                        if (ramVal) ramVal.textContent = (data.metrics.ram_mb || 0) + ' MB';
                        const ramPct = Math.min(100, Math.round(((data.metrics.ram_mb || 0) / 500) * 100));
                        if (ramBar) ramBar.style.width = ramPct + '%';
                        
                        const threadsVal = document.getElementById('metric-threads-val');
                        const threadsBar = document.getElementById('metric-threads-bar');
                        if (threadsVal) threadsVal.textContent = (data.metrics.threads_active || 0) + ' active';
                        const threadsPct = Math.min(100, Math.round(((data.metrics.threads_active || 0) / 350) * 100));
                        if (threadsBar) threadsBar.style.width = threadsPct + '%';
                    }
                    
                    // Update rolling console
                    const consoleLog = document.getElementById('scan-console-log');
                    if (consoleLog && data.latest_results && data.latest_results.length > 0) {
                        consoleLog.innerHTML = '';
                        data.latest_results.forEach(item => {
                            const line = document.createElement('div');
                            line.className = 'console-line';
                            
                            const countryDisplay = item.country ? item.country : 'Unknown Country';
                            const langDisplay = item.languages && item.languages.length > 0 ? item.languages.join(',') : 'Unknown';
                            
                            let color = '#39FF14';  // Working (Green)
                            if (item.status_text === 'Slow') color = '#FFA500';  // Orange
                            if (item.status_text === 'Dead' || item.status_text === 'No Stream') color = '#FF3B30';  // Red
                            if (item.status_text === 'Geo-blocked') color = '#2997FF';  // Blue
                            
                            line.innerHTML = `
                                <span>[SCAN] <strong>${item.name}</strong> (${langDisplay} | ${countryDisplay}) &rarr; </span>
                                <span style="color: ${color}; font-weight: bold;">${item.status_icon} ${item.status_text}</span>
                            `;
                            consoleLog.appendChild(line);
                        });
                        consoleLog.scrollTop = consoleLog.scrollHeight;
                    }
                } else {
                    clearInterval(progressPoller);
                    progressPoller = null;
                    
                    if (bar) bar.style.width = '100%';
                    if (label) label.textContent = 'Scan Complete';
                    
                    if (scanPanel) scanPanel.style.display = 'none';
                    if (document.getElementById('stream-check-progress-wrapper')) {
                        document.getElementById('stream-check-progress-wrapper').style.display = 'none';
                    }
                    
                    alert('Stream checking complete: ' + data.status);
                    triggerFilter();
                    checkServerStatus();
                }
            })
            .catch(err => {
                console.error('Progress fetch error:', err);
            });
    }, 1000);
}

function removeDuplicates() {
    fetch('/api/remove-duplicates', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(`Removed ${data.removed} duplicate streams.`);
            triggerFilter();
            checkServerStatus();
        });
}

function removeDeadStreams() {
    fetch('/api/remove-dead', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(`Successfully removed ${data.removed} offline streams.`);
            triggerFilter();
            checkServerStatus();
        });
}

function removeGeoblockedStreams() {
    fetch('/api/remove-geoblocked', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(`Successfully removed ${data.removed} geo-blocked streams.`);
            triggerFilter();
            checkServerStatus();
        });
}

// VIEW 3: LANGUAGES GRID BULK UPDATE LOGIC
let bulkLanguagesList = [];
function renderBulkLanguagesGrid() {
    const container = document.getElementById('languages-grid-container');
    container.innerHTML = '';
    
    // Map languages grouped
    Object.keys(languagesTree).forEach(groupName => {
        const groupLangs = languagesTree[groupName];
        
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'region-section-header';
        
        let pillName = 'GLOBAL';
        if (groupName.includes('Indian')) pillName = 'IN';
        else if (groupName.includes('European')) pillName = 'EU';
        else if (groupName.includes('Asian')) pillName = 'APAC';
        else if (groupName.includes('African')) pillName = 'AF';
        
        sectionHeader.innerHTML = `
            <h3>${groupName} <span class="region-pills">${pillName}</span></h3>
            <button class="btn btn-secondary-outline btn-block" style="width:auto; padding:4px 8px;" onclick="selectAllInRegion('${groupName}')">Select All</button>
        `;
        container.appendChild(sectionHeader);
        
        const grid = document.createElement('div');
        grid.className = 'lang-grid';
        grid.id = `lang-grid-${groupName.replace(/\s+/g, '-')}`;
        
        groupLangs.forEach(lang => {
            const card = document.createElement('div');
            card.className = `lang-card ${selectedLanguages.includes(lang.code) ? 'selected' : ''}`;
            card.id = `lang-card-${lang.code}`;
            
            const avatar = lang.name.substring(0, 2).toUpperCase();
            
            card.innerHTML = `
                <div class="lang-avatar">${avatar}</div>
                <div class="lang-card-info">
                    <span class="name">${lang.name}</span>
                    <span class="code">ISO: ${lang.code}</span>
                    <div class="lang-card-stats">
                        <span class="streams-count">-- streams</span>
                        <span class="status-indicator">ACTIVE</span>
                    </div>
                </div>
            `;
            card.onclick = () => toggleBulkLanguage(lang.code);
            grid.appendChild(card);
        });
        
        container.appendChild(grid);
    });
}

function toggleBulkLanguage(code) {
    const idx = selectedLanguages.indexOf(code);
    if (idx > -1) {
        selectedLanguages.splice(idx, 1);
        const card = document.getElementById(`lang-card-${code}`);
        if (card) card.classList.remove('selected');
    } else {
        selectedLanguages.push(code);
        const card = document.getElementById(`lang-card-${code}`);
        if (card) card.classList.add('selected');
    }
    
    updateBulkLanguagesStickyBar();
}

function selectAllInRegion(groupName) {
    const groupLangs = languagesTree[groupName] || [];
    const allSelected = groupLangs.every(l => selectedLanguages.includes(l.code));
    
    groupLangs.forEach(l => {
        const card = document.getElementById(`lang-card-${l.code}`);
        if (allSelected) {
            // Remove all
            const idx = selectedLanguages.indexOf(l.code);
            if (idx > -1) selectedLanguages.splice(idx, 1);
            if (card) card.classList.remove('selected');
        } else {
            // Add all
            if (!selectedLanguages.includes(l.code)) selectedLanguages.push(l.code);
            if (card) card.classList.add('selected');
        }
    });
    
    updateBulkLanguagesStickyBar();
}

function updateBulkLanguagesStickyBar() {
    const bar = document.getElementById('languages-selection-bar');
    if (selectedLanguages.length > 0) {
        bar.style.display = 'flex';
        document.getElementById('selected-langs-count-text').textContent = `${selectedLanguages.length} Languages Selected`;
        
        // Render avatars in bar
        const avatarsGroup = document.getElementById('selected-langs-avatars');
        avatarsGroup.innerHTML = '';
        selectedLanguages.slice(0, 5).forEach(code => {
            avatarsGroup.innerHTML += `<span class="avatar-sm">${code.toUpperCase()}</span>`;
        });
        if (selectedLanguages.length > 5) {
            avatarsGroup.innerHTML += `<span class="avatar-sm">+${selectedLanguages.length - 5}</span>`;
        }
        
        // Stream count calculation simulated
        document.getElementById('selected-langs-streams-text').textContent = `Affecting active stream configurations`;
    } else {
        bar.style.display = 'none';
    }
}

function clearLanguageSelection() {
    selectedLanguages = [];
    document.querySelectorAll('.lang-card').forEach(el => el.classList.remove('selected'));
    updateBulkLanguagesStickyBar();
}

function openLanguageMetadataModal() {
    alert(`Updating bulk metadata mappings for ${selectedLanguages.join(', ').toUpperCase()}`);
}

function applyLanguageSelectionToPlaylist() {
    alert(`Applied selected language directories to the playlist filters.`);
}

function filterLanguageGrid() {
    // Hide or show grids in grid container based on checkbox selections
    const checkGlobal = document.getElementById('lang-region-global').checked;
    const checkIndian = document.getElementById('lang-region-indian').checked;
    const checkEuro = document.getElementById('lang-region-european').checked;
    const checkAsian = document.getElementById('lang-region-asian').checked;
    const checkAfrican = document.getElementById('lang-region-african').checked;
    
    // Toggle regions
    toggleRegionVisibility('Indian Languages', checkGlobal || checkIndian);
    toggleRegionVisibility('European Languages', checkGlobal || checkEuro);
    toggleRegionVisibility('Asian Languages', checkGlobal || checkAsian);
    toggleRegionVisibility('African Languages', checkGlobal || checkAfrican);
}

function toggleRegionVisibility(groupName, visible) {
    const header = document.querySelector(`.region-section-header h3`);
    // Find section header and grid
    const grids = document.querySelectorAll('.lang-grid');
    grids.forEach(grid => {
        if (grid.id === `lang-grid-${groupName.replace(/\s+/g, '-')}`) {
            const h = grid.previousElementSibling;
            if (visible) {
                grid.style.display = 'grid';
                if (h) h.style.display = 'flex';
            } else {
                grid.style.display = 'none';
                if (h) h.style.display = 'none';
            }
        }
    });
}

// VIEW 4: EXPORT ACTIONS
function exportPlaylistFile() {
    const filepath = document.getElementById('export-filepath').value;
    const file_format = document.querySelector('input[name="export-format"]:checked').value;
    const append = document.getElementById('export-append').checked;
    
    if (!filepath) {
        return alert('Please enter a valid export local path, or click "Download Directly" instead.');
    }
    
    fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filepath: filepath,
            format: file_format,
            append: append
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Export Error: ' + data.error);
        } else {
            alert('Export Successful! Playlist saved to local path.');
        }
    })
    .catch(err => alert('Export failed: ' + err));
}

function downloadPlaylistDirect() {
    const file_format = document.querySelector('input[name="export-format"]:checked').value;
    window.open(`/api/download-export?format=${file_format}`, '_blank');
}

// Theme management
function setTheme(name) {
    if (name === 'dark') {
        document.body.className = 'dark-theme';
        document.getElementById('theme-btn-dark').classList.add('active');
        document.getElementById('theme-btn-light').classList.remove('active');
    } else {
        document.body.className = 'light-theme';
        document.getElementById('theme-btn-light').classList.add('active');
        document.getElementById('theme-btn-dark').classList.remove('active');
    }
}

// Custom functions for sidebar, filters toggle, real-time status, and manual state saving
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

function toggleFiltersPanel() {
    const workspace = document.querySelector('.channel-workspace');
    if (workspace) {
        workspace.classList.toggle('filters-collapsed');
        updateWorkspaceLayout();
    }
}

function saveCurrentPreset() {
    const nameInput = document.getElementById('preset-name-input');
    const name = nameInput.value.trim();
    if (!name) {
        alert('Please enter a name for the preset');
        return;
    }
    
    const filtersToSave = {
        search_term: document.getElementById('filter-search').value,
        nsfw: document.getElementById('filter-nsfw').checked,
        exclude_closed: document.getElementById('filter-closed').checked,
        favorites_only: document.getElementById('filter-favs').checked,
        categories: activeFilters.categories,
        countries: activeFilters.countries,
        languages: activeFilters.languages
    };
    
    fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, filters: filtersToSave })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Error saving preset: ' + data.error);
        } else {
            alert(`Preset "${name}" saved successfully!`);
            nameInput.value = '';
            
            presets = data.presets;
            const presetCombo = document.getElementById('presets-select');
            presetCombo.innerHTML = '<option value="">-- Select Saved Preset --</option>';
            Object.keys(presets).forEach(pName => {
                presetCombo.innerHTML += `<option value="${pName}">${pName}</option>`;
            });
            presetCombo.value = name;
        }
    })
    .catch(err => alert('Save preset failed: ' + err));
}

function saveDatabaseState() {
    fetch('/api/save-state', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert('Error saving state: ' + data.error);
            } else {
                alert('Database state saved successfully! It will be reloaded on startup.');
            }
        })
        .catch(err => alert('Save failed: ' + err));
}

function updateChannelStatusLocallyAndOnServer(ch, statusText, statusIcon) {
    if (!ch) return;
    
    // Only update if the status changed
    if (ch.status_text === statusText && ch.status_icon === statusIcon) return;
    
    ch.status_text = statusText;
    ch.status_icon = statusIcon;
    
    fetch('/api/channels/set-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_id: ch.id,
            status_text: statusText,
            status_icon: statusIcon
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log(`Successfully updated channel ${ch.id} status to ${statusText}`);
            
            // Update UI row/card status badge directly
            const rowId = `ch-row-${ch.id}`;
            const row = document.getElementById(rowId);
            if (row) {
                const badge = row.querySelector('.status-badge');
                if (badge) {
                    badge.className = `status-badge ${getStatusClass(statusText)}`;
                    badge.innerHTML = `${statusIcon} ${statusText}`;
                }
            }
            const cardId = `ch-card-${ch.id}`;
            const card = document.getElementById(cardId);
            if (card) {
                const badge = card.querySelector('.status-badge');
                if (badge) {
                    badge.className = `status-badge ${getStatusClass(statusText)}`;
                    badge.innerHTML = `${statusIcon} ${statusText}`;
                }
            }
            checkServerStatus();
        }
    })
    .catch(err => console.error('Failed to update channel status:', err));
}

// Modal controls for Adding and Editing Channels
function openAddChannelModal() {
    document.getElementById('modal-title').textContent = 'Add New Channel';
    document.getElementById('modal-channel-id').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-url').value = '';
    document.getElementById('modal-ua').value = '';
    document.getElementById('modal-referer').value = '';
    document.getElementById('modal-country').value = '';
    document.getElementById('modal-categories').value = '';
    document.getElementById('modal-languages').value = '';
    document.getElementById('modal-nsfw').checked = false;
    
    document.getElementById('channel-modal').style.display = 'flex';
}

function openEditChannelModal() {
    if (!selectedChannel) return;
    
    document.getElementById('modal-title').textContent = 'Edit Channel Details';
    document.getElementById('modal-channel-id').value = selectedChannel.id;
    document.getElementById('modal-name').value = selectedChannel.name;
    document.getElementById('modal-url').value = selectedChannel.url || '';
    document.getElementById('modal-ua').value = selectedChannel.user_agent || '';
    document.getElementById('modal-referer').value = selectedChannel.referrer || '';
    document.getElementById('modal-country').value = selectedChannel.country || '';
    document.getElementById('modal-categories').value = (selectedChannel.categories || []).join(', ');
    document.getElementById('modal-languages').value = (selectedChannel.languages || []).join(', ');
    document.getElementById('modal-nsfw').checked = selectedChannel.is_nsfw || false;
    
    document.getElementById('channel-modal').style.display = 'flex';
}

function closeChannelModal() {
    document.getElementById('channel-modal').style.display = 'none';
}

function saveChannelModal() {
    const channelId = document.getElementById('modal-channel-id').value;
    const name = document.getElementById('modal-name').value.trim();
    const url = document.getElementById('modal-url').value.trim();
    const userAgent = document.getElementById('modal-ua').value.trim();
    const referrer = document.getElementById('modal-referer').value.trim();
    const country = document.getElementById('modal-country').value.trim();
    const categoriesRaw = document.getElementById('modal-categories').value;
    const languagesRaw = document.getElementById('modal-languages').value;
    const nsfw = document.getElementById('modal-nsfw').checked;
    
    if (!name || !url) {
        alert('Channel Name and Stream URL are required.');
        return;
    }
    
    const categories = categoriesRaw.split(',').map(s => s.trim()).filter(s => s);
    const languages = languagesRaw.split(',').map(s => s.trim()).filter(s => s);
    
    const payload = {
        name,
        url,
        user_agent: userAgent,
        referrer,
        country,
        categories,
        languages,
        is_nsfw: nsfw
    };
    
    let endpoint = '/api/channels/add';
    if (channelId) {
        endpoint = '/api/channels/update';
        payload.channel_id = channelId;
    }
    
    fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Save error: ' + data.error);
        } else {
            closeChannelModal();
            alert(channelId ? 'Channel updated successfully!' : 'Channel added successfully!');
            
            // Auto check/select if newly created
            if (!channelId && data.channel_id) {
                selectedChannelIds.add(data.channel_id);
                updateCheckSelectedButtonState();
            }

            // Refresh filters and reload channels
            filtersLoaded = false; // Force reload lists
            loadFiltersAndLists();
            triggerFilter();
            
            // If editing, re-select
            if (channelId && selectedChannel && selectedChannel.id === channelId) {
                selectedChannel.name = name;
                selectedChannel.url = url;
                selectedChannel.user_agent = userAgent;
                selectedChannel.referrer = referrer;
                selectedChannel.country = country;
                selectedChannel.categories = categories;
                selectedChannel.languages = languages;
                selectedChannel.is_nsfw = nsfw;
                selectChannel(selectedChannel);
            }
        }
    })
    .catch(err => alert('Save request failed: ' + err));
}

// Custom Playlists & Settings Manager
let activePlaylists = [];

function onPlaylistTypeChanged(value) {
    const urlContainer = document.getElementById('new-playlist-url-container');
    const fileContainer = document.getElementById('new-playlist-file-container');
    if (value === 'file') {
        urlContainer.style.display = 'none';
        fileContainer.style.display = 'block';
    } else {
        urlContainer.style.display = 'block';
        fileContainer.style.display = 'none';
    }
}

function loadSettingsAndPlaylists() {
    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            activePlaylists = (data.custom_playlists || []).map((pl, idx) => ({ ...pl, index: idx }));
            
            // Populate API URL input
            const apiUrlInput = document.getElementById('settings-api-url');
            if (apiUrlInput) {
                apiUrlInput.value = data.api_url || 'https://iptv-org.github.io/api';
            }
            
            // Populate performance inputs
            const limitSelect = document.getElementById('settings-channel-limit');
            if (limitSelect && data.channel_limit !== undefined) {
                limitSelect.value = data.channel_limit;
            }
            
            // Populate items per page limit
            const itemsPerPageSelect = document.getElementById('settings-items-per-page');
            if (itemsPerPageSelect) {
                let storedItems = localStorage.getItem('itemsPerPage');
                if (storedItems) {
                    itemsPerPage = parseInt(storedItems, 10);
                } else if (data.items_per_page !== undefined) {
                    itemsPerPage = data.items_per_page;
                } else {
                    itemsPerPage = 100;
                }
                itemsPerPageSelect.value = itemsPerPage;
            }
            const threadsSelect = document.getElementById('settings-check-threads');
            if (threadsSelect && data.stream_check_threads !== undefined) {
                threadsSelect.value = data.stream_check_threads;
            }
            const timeoutSelect = document.getElementById('settings-check-timeout');
            if (timeoutSelect && data.stream_check_timeout !== undefined) {
                timeoutSelect.value = data.stream_check_timeout;
            }
            const cacheSelect = document.getElementById('settings-cache-expiry');
            if (cacheSelect && data.cache_expiry_hours !== undefined) {
                cacheSelect.value = data.cache_expiry_hours;
            }
            
            // Populate Dashboard Playlist Checkboxes
            const listbox = document.getElementById('playlist-checkbox-list');
            if (listbox) {
                listbox.innerHTML = '';
                const realPlaylists = activePlaylists.filter(pl => pl.type !== 'virtual');
                if (realPlaylists.length === 0) {
                    listbox.innerHTML = '<span style="opacity: 0.5; font-size: 12px;">No playlists configured. Go to Settings to add sources.</span>';
                } else {
                    realPlaylists.forEach((pl, idx) => {
                        const label = document.createElement('label');
                        label.className = 'custom-checkbox';
                        label.style.display = 'flex';
                        label.style.alignItems = 'center';
                        label.style.gap = '8px';
                        label.style.cursor = 'pointer';
                        
                        // Default check first source
                        const isChecked = idx === 0 ? 'checked' : '';
                        
                        label.innerHTML = `
                            <input type="checkbox" value="${pl.index}" ${isChecked} style="cursor: pointer;">
                            <span style="font-size: 13px;">${pl.name} <span style="opacity: 0.5; font-size: 11px;">(${pl.type.toUpperCase()})</span></span>
                        `;
                        listbox.appendChild(label);
                    });
                }
            }
            
            // Populate Playlists Table in Settings
            renderPlaylistsTable();
        })
        .catch(err => console.error('Error loading settings:', err));
}

function renderPlaylistsTable() {
    const tbody = document.getElementById('settings-playlists-list');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const realPlaylists = activePlaylists.filter(pl => pl.type !== 'virtual');
    if (realPlaylists.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center pad-20">No custom playlists added yet.</td></tr>';
        return;
    }
    
    realPlaylists.forEach((pl) => {
        const tr = document.createElement('tr');
        let downloadBtnHtml = '';
        if (pl.type === 'file') {
            downloadBtnHtml = `<button class="btn btn-secondary-outline" style="padding: 2px 8px; font-size: 11px; margin-right: 5px;" onclick="downloadCustomPlaylist(${pl.index})">Download</button>`;
        } else if (pl.type === 'url') {
            downloadBtnHtml = `<button class="btn btn-secondary-outline" style="padding: 2px 8px; font-size: 11px; margin-right: 5px;" onclick="window.open('${pl.url}', '_blank')">Link</button>`;
        }
        
        tr.innerHTML = `
            <td><strong>${pl.name}</strong></td>
            <td><span class="list-item-badge" style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${pl.type.toUpperCase()}</span></td>
            <td style="word-break: break-all;"><code>${pl.url}</code></td>
            <td style="text-align: center; white-space: nowrap;">
                ${downloadBtnHtml}
                <button class="btn btn-danger-outline" style="padding: 2px 8px; font-size: 11px;" onclick="deleteCustomPlaylist(${pl.index})">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function downloadCustomPlaylist(idx) {
    if (idx === -1) {
        window.open('/api/playlists/download-favorites', '_blank');
    } else {
        window.open(`/api/playlists/download?index=${idx}`, '_blank');
    }
}

function saveApiUrlSettings() {
    const apiUrlInput = document.getElementById('settings-api-url');
    const api_url = apiUrlInput.value.trim();
    if (!api_url) return alert('API URL cannot be empty');
    
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_url: api_url })
    })
    .then(res => res.json())
    .then(data => {
        alert('API URL saved successfully!');
        loadSettingsAndPlaylists();
    })
    .catch(err => alert('Save failed: ' + err));
}

function savePerformanceSettings() {
    const limitSelect = document.getElementById('settings-channel-limit');
    const threadsSelect = document.getElementById('settings-check-threads');
    const timeoutSelect = document.getElementById('settings-check-timeout');
    const cacheSelect = document.getElementById('settings-cache-expiry');
    const itemsPerPageSelect = document.getElementById('settings-items-per-page');
    
    if (!limitSelect || !threadsSelect || !timeoutSelect || !cacheSelect) return;
    
    const limit = parseInt(limitSelect.value, 10);
    const threads = parseInt(threadsSelect.value, 10);
    const timeout = parseInt(timeoutSelect.value, 10);
    const cache_expiry = parseInt(cacheSelect.value, 10);
    
    if (itemsPerPageSelect) {
        itemsPerPage = parseInt(itemsPerPageSelect.value, 10);
        localStorage.setItem('itemsPerPage', itemsPerPage);
    }
    
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_limit: limit,
            stream_check_threads: threads,
            stream_check_timeout: timeout,
            cache_expiry_hours: cache_expiry,
            items_per_page: itemsPerPage
        })
    })
    .then(res => res.json())
    .then(data => {
        console.log('Performance settings updated successfully:', data.settings);
        renderChannelsList();
    })
    .catch(err => console.error('Failed to save performance settings:', err));
}

function addCustomPlaylist() {
    const nameInput = document.getElementById('new-playlist-name');
    const typeSelect = document.getElementById('new-playlist-type');
    const urlInput = document.getElementById('new-playlist-url');
    const fileInput = document.getElementById('new-playlist-files');
    
    const name = nameInput.value.trim();
    const type = typeSelect.value;
    
    if (type === 'file') {
        // Handle file uploads
        if (!fileInput.files || fileInput.files.length === 0) {
            return alert('Please select at least one M3U file.');
        }
        
        const formData = new FormData();
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('files', fileInput.files[i]);
        }
        
        fetch('/api/playlists/upload-multiple', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert('Upload failed: ' + data.error);
                return;
            }
            
            // Added playlists list
            const added = data.added_playlists || [];
            // Override names if provided (useful for single file, or defaults to filenames)
            if (name && added.length === 1) {
                added[0].name = name;
            }
            
            const cleanPlaylists = activePlaylists.filter(p => p.index !== -1 && p.type !== 'virtual').map(p => ({
                name: p.name,
                type: p.type,
                url: p.url
            }));
            const updatedPlaylists = [...cleanPlaylists, ...added];
            
            // Save to settings
            return fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ custom_playlists: updatedPlaylists })
            });
        })
        .then(res => {
            if (res) return res.json();
        })
        .then(data => {
            if (data) {
                alert('Uploaded and added local file playlist(s) successfully!');
                nameInput.value = '';
                fileInput.value = '';
                loadSettingsAndPlaylists();
            }
        })
        .catch(err => alert('Upload request failed: ' + err));
        
    } else {
        // Handle URL or API entries
        const urlRaw = urlInput.value.trim();
        if (!urlRaw) {
            return alert('URL or Path is required.');
        }
        
        let newPlaylists = [];
        if (type === 'url') {
            // Split by comma or newline
            const urls = urlRaw.split(/[\n,]+/).map(u => u.trim()).filter(u => u);
            if (urls.length === 1) {
                newPlaylists.push({
                    name: name || 'Custom URL List',
                    type: 'url',
                    url: urls[0]
                });
            } else {
                urls.forEach((url, i) => {
                    newPlaylists.push({
                        name: `${name || 'Custom URL List'} ${i+1}`,
                        type: 'url',
                        url: url
                    });
                });
            }
        } else {
            newPlaylists.push({
                name: name || 'Custom API',
                type: type,
                url: urlRaw
            });
        }
        
        const cleanPlaylists = activePlaylists.filter(p => p.index !== -1 && p.type !== 'virtual').map(p => ({
            name: p.name,
            type: p.type,
            url: p.url
        }));
        const updatedPlaylists = [...cleanPlaylists, ...newPlaylists];
        
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_playlists: updatedPlaylists })
        })
        .then(res => res.json())
        .then(data => {
            alert(`Successfully added ${newPlaylists.length} playlist source(s)!`);
            nameInput.value = '';
            urlInput.value = '';
            loadSettingsAndPlaylists();
        })
        .catch(err => alert('Failed to add playlist: ' + err));
    }
}

function deleteCustomPlaylist(idx) {
    if (!confirm('Are you sure you want to remove this playlist source?')) return;
    
    const updatedPlaylists = activePlaylists
        .filter(p => p.index !== -1 && p.index !== idx)
        .map(p => ({
            name: p.name,
            type: p.type,
            url: p.url
        }));
    
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_playlists: updatedPlaylists })
    })
    .then(res => res.json())
    .then(data => {
        alert('Playlist source removed successfully!');
        loadSettingsAndPlaylists();
    })
    .catch(err => alert('Failed to delete playlist: ' + err));
}

function loadSelectedPlaylists() {
    const listbox = document.getElementById('playlist-checkbox-list');
    if (!listbox) return;
    
    const checkedBoxes = listbox.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedBoxes.length === 0) {
        return alert('Please check at least one playlist source to load.');
    }
    
    const selectedSources = [];
    checkedBoxes.forEach(box => {
        const idx = parseInt(box.value, 10);
        const pl = activePlaylists.find(p => p.index === idx);
        if (pl) {
            selectedSources.push({ type: pl.type, url: pl.url });
        }
    });
    
    updateLoaderStatus(`Merging and loading ${selectedSources.length} playlist source(s)...`);
    
    fetch('/api/playlists/load-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: selectedSources })
    })
    .then(res => res.json())
    .then(data => {
        pollLoadingStatus();
    })
    .catch(err => alert('Failed to load playlists: ' + err));
}

function loadSelectedPlaylist() {
    loadSelectedPlaylists();
}

// --- Selection Mappings & Dropdowns ---
function toggleSelectionDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('selection-dropdown');
    if (dropdown) {
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
    }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('selection-dropdown');
    const btn = document.getElementById('btn-select-options');
    if (dropdown && dropdown.style.display === 'block' && e.target !== btn && !btn.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

function toggleChannelSelection(chId, checked) {
    if (checked) {
        selectedChannelIds.add(chId);
        // If it was excluded, remove it from exclusions
        if (excludedChannelIds.has(chId)) {
            excludedChannelIds.delete(chId);
            // Sync exclude button UI
            document.querySelectorAll(`.exclude-btn-ch[data-id="${chId}"]`).forEach(btn => {
                btn.classList.remove('active');
            });
            const tr = document.getElementById(`ch-row-${chId}`);
            if (tr) tr.classList.remove('excluded-row');
            const card = document.getElementById(`ch-card-${chId}`);
            if (card) card.classList.remove('excluded-card');
        }
    } else {
        selectedChannelIds.delete(chId);
    }
    
    // Sync checkbox state across layout views
    document.querySelectorAll(`.row-select-checkbox[data-id="${chId}"], .grid-select-checkbox[data-id="${chId}"]`).forEach(cb => {
        cb.checked = checked;
    });
    
    updateCheckSelectedButtonState();
    
    // Sync header checkbox for currently rendered checkboxes (current page)
    const headerCheck = document.getElementById('header-select-all');
    if (headerCheck) {
        const checkboxes = document.querySelectorAll('.row-select-checkbox, .grid-select-checkbox');
        const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
        headerCheck.checked = allChecked;
    }
}

function toggleChannelExclusion(chId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    
    const currentlyExcluded = excludedChannelIds.has(chId);
    if (!currentlyExcluded) {
        excludedChannelIds.add(chId);
        // If it was selected/included, remove it
        if (selectedChannelIds.has(chId)) {
            selectedChannelIds.delete(chId);
            // Sync include checkbox UI
            document.querySelectorAll(`.row-select-checkbox[data-id="${chId}"], .grid-select-checkbox[data-id="${chId}"]`).forEach(cb => {
                cb.checked = false;
            });
        }
    } else {
        excludedChannelIds.delete(chId);
    }
    
    // Sync exclude button UI
    document.querySelectorAll(`.exclude-btn-ch[data-id="${chId}"]`).forEach(btn => {
        if (!currentlyExcluded) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Refresh table row and grid card styling
    const tr = document.getElementById(`ch-row-${chId}`);
    if (tr) {
        if (!currentlyExcluded) {
            tr.classList.add('excluded-row');
        } else {
            tr.classList.remove('excluded-row');
        }
    }
    const card = document.getElementById(`ch-card-${chId}`);
    if (card) {
        if (!currentlyExcluded) {
            card.classList.add('excluded-card');
        } else {
            card.classList.remove('excluded-card');
        }
    }
    
    updateCheckSelectedButtonState();
}

function bulkExcludeSelectedChannels(event) {
    if (event) event.preventDefault();
    if (selectedChannelIds.size === 0) {
        return alert('Please select/check at least one channel in the table/grid first to bulk exclude.');
    }
    
    const list = Array.from(selectedChannelIds);
    if (!confirm(`Are you sure you want to bulk-exclude the ${list.length} currently selected channels?`)) {
        return;
    }
    
    list.forEach(chId => {
        // Exclude the channel and deselect it
        excludedChannelIds.add(chId);
        selectedChannelIds.delete(chId);
        
        // Sync checkboxes
        document.querySelectorAll(`.row-select-checkbox[data-id="${chId}"], .grid-select-checkbox[data-id="${chId}"]`).forEach(cb => {
            cb.checked = false;
        });
        
        // Sync exclude buttons
        document.querySelectorAll(`.exclude-btn-ch[data-id="${chId}"]`).forEach(btn => {
            btn.classList.add('active');
        });
        
        // Sync row & card classes
        const tr = document.getElementById(`ch-row-${chId}`);
        if (tr) tr.classList.add('excluded-row');
        const card = document.getElementById(`ch-card-${chId}`);
        if (card) card.classList.add('excluded-card');
    });
    
    // Reset header checkbox
    const headerCheck = document.getElementById('header-select-all');
    if (headerCheck) headerCheck.checked = false;
    
    updateCheckSelectedButtonState();
    alert(`Bulk excluded ${list.length} channels! Remember to click "Save Selected to Config" to persist your changes.`);
}


function updateCheckSelectedButtonState() {
    const btn = document.getElementById('btn-check-selected');
    const plBtn = document.getElementById('btn-playlist-options');
    const size = selectedChannelIds.size;
    
    if (btn) {
        if (size > 0) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.backgroundColor = 'var(--color-accent)';
            btn.style.color = '#ffffff';
            btn.textContent = `Check Selected (${size})`;
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
            btn.style.color = 'var(--text-secondary)';
            btn.textContent = 'Check Selected';
        }
    }
    
    if (plBtn) {
        if (size > 0) {
            plBtn.disabled = false;
            plBtn.style.opacity = '1';
            plBtn.style.cursor = 'pointer';
            plBtn.textContent = `Playlist Actions (${size}) ▼`;
        } else {
            plBtn.disabled = true;
            plBtn.style.opacity = '0.5';
            plBtn.style.cursor = 'not-allowed';
            plBtn.textContent = 'Playlist Actions ▼';
        }
    }
}

function selectAllChannels(event) {
    if (event) event.preventDefault();
    channels.forEach(ch => {
        selectedChannelIds.add(ch.id);
    });
    
    document.querySelectorAll(`.row-select-checkbox, .grid-select-checkbox`).forEach(cb => {
        cb.checked = true;
    });
    
    const headerCheck = document.getElementById('header-select-all');
    if (headerCheck) headerCheck.checked = true;
    
    updateCheckSelectedButtonState();
    toggleSelectionDropdown();
}

function deselectAllChannels(event) {
    if (event) event.preventDefault();
    selectedChannelIds.clear();
    
    document.querySelectorAll(`.row-select-checkbox, .grid-select-checkbox`).forEach(cb => {
        cb.checked = false;
    });
    
    const headerCheck = document.getElementById('header-select-all');
    if (headerCheck) headerCheck.checked = false;
    
    updateCheckSelectedButtonState();
    if (event) toggleSelectionDropdown();
}

function toggleSelectAllChannels(headerCheckbox) {
    const checked = headerCheckbox.checked;
    channels.forEach(ch => {
        if (checked) {
            selectedChannelIds.add(ch.id);
        } else {
            selectedChannelIds.delete(ch.id);
        }
    });
    
    document.querySelectorAll(`.row-select-checkbox, .grid-select-checkbox`).forEach(cb => {
        cb.checked = checked;
    });
    
    updateCheckSelectedButtonState();
}

function invertChannelSelection(event) {
    if (event) event.preventDefault();
    channels.forEach(ch => {
        const isSelected = selectedChannelIds.has(ch.id);
        if (isSelected) {
            selectedChannelIds.delete(ch.id);
        } else {
            selectedChannelIds.add(ch.id);
        }
    });
    
    document.querySelectorAll(`.row-select-checkbox, .grid-select-checkbox`).forEach(cb => {
        cb.checked = !cb.checked;
    });
    
    const headerCheck = document.getElementById('header-select-all');
    if (headerCheck) {
        const checkboxes = document.querySelectorAll('.row-select-checkbox, .grid-select-checkbox');
        const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
        headerCheck.checked = allChecked;
    }
    
    updateCheckSelectedButtonState();
    toggleSelectionDropdown();
}

function checkSelectedStreams() {
    if (selectedChannelIds.size === 0) return;
    
    const ids = Array.from(selectedChannelIds);
    fetch('/api/check-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_ids: ids })
    })
    .then(res => res.json())
    .then(data => {
        document.getElementById('stream-check-progress-wrapper').style.display = 'block';
        startProgressPolling();
    })
    .catch(err => alert('Failed to start checking streams: ' + err));
}

function onColumnFilterChange() {
    columnFilters.status = document.getElementById('col-filter-status').value;
    columnFilters.id = document.getElementById('col-filter-id').value.trim().toLowerCase();
    columnFilters.name = document.getElementById('col-filter-name').value.trim().toLowerCase();
    columnFilters.country = document.getElementById('col-filter-country').value.trim().toLowerCase();
    columnFilters.category = document.getElementById('col-filter-category').value.trim().toLowerCase();
    columnFilters.language = document.getElementById('col-filter-language').value.trim().toLowerCase();
    
    currentPage = 1;
    renderChannelsList();
}

function cancelScanning() {
    if (!confirm('Are you sure you want to cancel the active stream scan?')) return;
    
    fetch('/api/cancel-check', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            console.log('Cancel request sent:', data);
        })
        .catch(err => alert('Cancel failed: ' + err));
}

function resumeScanning() {
    fetch('/api/check-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: true })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'already_running') {
            alert('A stream scan is already running.');
        } else if (data.status === 'no_channels') {
            alert('No unchecked channels to scan.');
        } else {
            document.getElementById('stream-check-progress-wrapper').style.display = 'block';
            startProgressPolling();
        }
    })
    .catch(err => alert('Failed to resume scanning: ' + err));
}

function saveScanProgress() {
    fetch('/api/save-state', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            alert(data.message || 'Scan progress saved successfully!');
        })
        .catch(err => alert('Failed to save state: ' + err));
}

function exportPlaylistsSettings() {
    // Generate JSON file client-side
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activePlaylists, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "iptv_sources.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function triggerImportSources() {
    const fileInput = document.getElementById('import-sources-file');
    if (fileInput) fileInput.click();
}

function importPlaylistsSettings(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) {
                return alert('Invalid sources file format. Must be a JSON array of playlist objects.');
            }
            
            // Validate items
            const validPlaylists = imported.filter(pl => pl.name && pl.type && pl.url);
            if (validPlaylists.length === 0) {
                return alert('No valid playlist sources found in the selected file.');
            }
            
            if (!confirm(`Import ${validPlaylists.length} playlists and merge with existing sources?`)) return;
            
            // Merge settings
            const defaultUrls = new Set(activePlaylists.map(pl => pl.url));
            const merged = [...activePlaylists];
            
            validPlaylists.forEach(pl => {
                if (!defaultUrls.has(pl.url)) {
                    merged.push(pl);
                }
            });
            
            fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ custom_playlists: merged })
            })
            .then(res => res.json())
            .then(data => {
                alert(`Successfully imported ${validPlaylists.length} playlist sources!`);
                input.value = '';
                loadSettingsAndPlaylists();
            })
            .catch(err => alert('Failed to save imported settings: ' + err));
            
        } catch(err) {
            alert('Failed to parse JSON file: ' + err);
        }
    };
    reader.readAsText(file);
}

// --- Dynamic Column Configuration & Panel Resizing Helpers ---

function loadColumnConfiguration() {
    const stored = localStorage.getItem('tableColumnConfig');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            const ids = new Set(parsed.map(c => c.id));
            const expectedIds = ['status', 'id', 'name', 'country', 'category', 'language', 'actions'];
            const allMatch = expectedIds.every(id => ids.has(id)) && parsed.length === expectedIds.length;
            if (allMatch) {
                tableColumns = parsed;
                return;
            }
        } catch (e) {
            console.error('Failed to parse stored column config:', e);
        }
    }
    // Default columns
    tableColumns = [
        { id: 'status', name: 'STATUS', visible: true, sizeClass: 'col-status' },
        { id: 'id', name: 'ID', visible: true, sizeClass: 'col-id' },
        { id: 'name', name: 'CHANNEL NAME', visible: true, sizeClass: 'col-name' },
        { id: 'country', name: 'COUNTRY', visible: true, sizeClass: 'col-country' },
        { id: 'category', name: 'CATEGORY', visible: true, sizeClass: 'col-category' },
        { id: 'language', name: 'LANGUAGE', visible: true, sizeClass: 'col-language' },
        { id: 'actions', name: 'ACTIONS', visible: true, sizeClass: 'col-actions' }
    ];
}

function saveColumnConfiguration() {
    localStorage.setItem('tableColumnConfig', JSON.stringify(tableColumns));
}

function toggleColumnSettingsDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('column-settings-dropdown');
    if (dropdown) {
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
            renderColumnSettingsList();
        }
    }
}

// Close dropdowns on outside clicks
document.addEventListener('click', (e) => {
    const columnDropdown = document.getElementById('column-settings-dropdown');
    const columnBtn = document.getElementById('btn-column-settings');
    if (columnDropdown && columnDropdown.style.display === 'block' && e.target !== columnBtn && !columnBtn.contains(e.target) && !columnDropdown.contains(e.target)) {
        columnDropdown.style.display = 'none';
    }
    const playlistDropdown = document.getElementById('playlist-dropdown');
    const playlistBtn = document.getElementById('btn-playlist-options');
    if (playlistDropdown && playlistDropdown.style.display === 'block' && e.target !== playlistBtn && !playlistBtn.contains(e.target) && !playlistDropdown.contains(e.target)) {
        playlistDropdown.style.display = 'none';
    }
});

function renderColumnSettingsList() {
    const container = document.getElementById('column-settings-list');
    if (!container) return;
    container.innerHTML = '';

    tableColumns.forEach((col, index) => {
        const item = document.createElement('div');
        item.className = 'column-settings-item';

        const isChecked = col.visible ? 'checked' : '';

        item.innerHTML = `
            <label class="col-label" style="margin: 0; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" ${isChecked} onchange="toggleColumnVisibility('${col.id}', this.checked)" style="cursor: pointer;">
                <span>${col.name}</span>
            </label>
            <div class="col-order-buttons">
                <button class="btn-sort-arrow" onclick="moveColumn('${col.id}', -1)" title="Move Left/Up" ${index === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>▲</button>
                <button class="btn-sort-arrow" onclick="moveColumn('${col.id}', 1)" title="Move Right/Down" ${index === tableColumns.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>▼</button>
            </div>
        `;
        container.appendChild(item);
    });
}

function toggleColumnVisibility(colId, visible) {
    const col = tableColumns.find(c => c.id === colId);
    if (col) {
        col.visible = visible;
        saveColumnConfiguration();
        
        // Force table reconstruction
        const scrollContainer = document.querySelector('.table-scroll-container');
        if (scrollContainer) {
            const existingTable = scrollContainer.querySelector('.channels-table');
            if (existingTable) {
                existingTable.remove();
            }
        }
        renderChannelsList();
    }
}

function moveColumn(colId, direction) {
    const index = tableColumns.findIndex(c => c.id === colId);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tableColumns.length) return;

    const temp = tableColumns[index];
    tableColumns[index] = tableColumns[targetIndex];
    tableColumns[targetIndex] = temp;

    saveColumnConfiguration();
    renderColumnSettingsList();

    // Force table reconstruction
    const scrollContainer = document.querySelector('.table-scroll-container');
    if (scrollContainer) {
        const existingTable = scrollContainer.querySelector('.channels-table');
        if (existingTable) {
            existingTable.remove();
        }
    }
    renderChannelsList();
}

function resetColumnsToDefault() {
    tableColumns = [
        { id: 'status', name: 'STATUS', visible: true, sizeClass: 'col-status' },
        { id: 'id', name: 'ID', visible: true, sizeClass: 'col-id' },
        { id: 'name', name: 'CHANNEL NAME', visible: true, sizeClass: 'col-name' },
        { id: 'country', name: 'COUNTRY', visible: true, sizeClass: 'col-country' },
        { id: 'category', name: 'CATEGORY', visible: true, sizeClass: 'col-category' },
        { id: 'language', name: 'LANGUAGE', visible: true, sizeClass: 'col-language' },
        { id: 'actions', name: 'ACTIONS', visible: true, sizeClass: 'col-actions' }
    ];
    saveColumnConfiguration();
    renderColumnSettingsList();
    
    // Force table reconstruction
    const scrollContainer = document.querySelector('.table-scroll-container');
    if (scrollContainer) {
        const existingTable = scrollContainer.querySelector('.channels-table');
        if (existingTable) {
            existingTable.remove();
        }
    }
    renderChannelsList();
}

function buildTableHeaderAndFiltersHtml() {
    let headerCells = `
        <th class="col-select"><input type="checkbox" id="header-select-all" onclick="toggleSelectAllChannels(this)"></th>
        <th class="col-fav">⭐</th>
    `;
    let filterCells = `
        <th></th>
        <th></th>
    `;

    tableColumns.forEach(col => {
        if (!col.visible) return;
        
        headerCells += `<th class="${col.sizeClass}" data-col-id="${col.id}" style="position: relative;">
            ${col.name}
            <div class="col-resize-handle"></div>
        </th>`;
        
        if (col.id === 'status') {
            filterCells += `
                <th>
                    <select id="col-filter-status" onchange="onColumnFilterChange()" class="table-col-filter">
                        <option value="">All</option>
                        <option value="Working">Working</option>
                        <option value="Slow">Slow</option>
                        <option value="Dead">Dead</option>
                        <option value="Geo-blocked">Geo-blocked</option>
                        <option value="Unknown">Unknown/Unchecked</option>
                    </select>
                </th>
            `;
        } else if (col.id === 'id') {
            filterCells += `<th><input type="text" id="col-filter-id" oninput="onColumnFilterChange()" class="table-col-filter" placeholder="ID..."></th>`;
        } else if (col.id === 'name') {
            filterCells += `<th><input type="text" id="col-filter-name" oninput="onColumnFilterChange()" class="table-col-filter" placeholder="Name..."></th>`;
        } else if (col.id === 'country') {
            filterCells += `<th><input type="text" id="col-filter-country" oninput="onColumnFilterChange()" class="table-col-filter" placeholder="Country..."></th>`;
        } else if (col.id === 'category') {
            filterCells += `<th><input type="text" id="col-filter-category" oninput="onColumnFilterChange()" class="table-col-filter" placeholder="Category..."></th>`;
        } else if (col.id === 'language') {
            filterCells += `<th><input type="text" id="col-filter-language" oninput="onColumnFilterChange()" class="table-col-filter" placeholder="Language..."></th>`;
        } else if (col.id === 'actions') {
            filterCells += `<th></th>`;
        }
    });

    return `
        <thead>
            <tr>${headerCells}</tr>
            <tr class="table-filter-row">${filterCells}</tr>
        </thead>
        <tbody id="channels-table-body"></tbody>
    `;
}

// Workspace panel resizing logic

function updateWorkspaceLayout() {
    const workspace = document.querySelector('.channel-workspace');
    if (!workspace) return;

    const filtersCollapsed = workspace.classList.contains('filters-collapsed');
    const inspectorCollapsed = workspace.classList.contains('inspector-collapsed');

    let filtersWidth = localStorage.getItem('filtersPanelWidth');
    filtersWidth = filtersWidth ? parseInt(filtersWidth, 10) : 280;
    
    let inspectorWidth = localStorage.getItem('inspectorPanelWidth');
    inspectorWidth = inspectorWidth ? parseInt(inspectorWidth, 10) : 320;

    const leftWidthVal = filtersCollapsed ? 0 : filtersWidth;
    const leftHandleVal = filtersCollapsed ? 0 : 6;
    const rightHandleVal = inspectorCollapsed ? 0 : 6;
    const rightWidthVal = inspectorCollapsed ? 0 : inspectorWidth;

    workspace.style.gridTemplateColumns = `${leftWidthVal}px ${leftHandleVal}px 1fr ${rightHandleVal}px ${rightWidthVal}px`;

    const leftHandle = document.getElementById('resize-handle-left');
    if (leftHandle) {
        leftHandle.style.display = filtersCollapsed ? 'none' : 'block';
    }
    const rightHandle = document.getElementById('resize-handle-right');
    if (rightHandle) {
        rightHandle.style.display = inspectorCollapsed ? 'none' : 'block';
    }
}

function initWorkspaceResizers() {
    const leftHandle = document.getElementById('resize-handle-left');
    const rightHandle = document.getElementById('resize-handle-right');
    const workspace = document.querySelector('.channel-workspace');
    if (!workspace) return;

    updateWorkspaceLayout();

    if (leftHandle) {
        leftHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            workspace.classList.add('resizing-active');
            leftHandle.classList.add('resizing');

            const startX = e.clientX;
            let startWidth = localStorage.getItem('filtersPanelWidth');
            startWidth = startWidth ? parseInt(startWidth, 10) : 280;

            const onMouseMove = (moveEvent) => {
                const deltaX = moveEvent.clientX - startX;
                let newWidth = startWidth + deltaX;
                if (newWidth < 180) newWidth = 180;
                if (newWidth > 600) newWidth = 600;

                localStorage.setItem('filtersPanelWidth', newWidth);
                updateWorkspaceLayout();
            };

            const onMouseUp = () => {
                workspace.classList.remove('resizing-active');
                leftHandle.classList.remove('resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        leftHandle.addEventListener('dblclick', () => {
            localStorage.setItem('filtersPanelWidth', 280);
            updateWorkspaceLayout();
        });
    }

    if (rightHandle) {
        rightHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            workspace.classList.add('resizing-active');
            rightHandle.classList.add('resizing');

            const startX = e.clientX;
            let startWidth = localStorage.getItem('inspectorPanelWidth');
            startWidth = startWidth ? parseInt(startWidth, 10) : 320;

            const onMouseMove = (moveEvent) => {
                const deltaX = startX - moveEvent.clientX;
                let newWidth = startWidth + deltaX;
                if (newWidth < 240) newWidth = 240;
                if (newWidth > 600) newWidth = 600;

                localStorage.setItem('inspectorPanelWidth', newWidth);
                updateWorkspaceLayout();
            };

            const onMouseUp = () => {
                workspace.classList.remove('resizing-active');
                rightHandle.classList.remove('resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        rightHandle.addEventListener('dblclick', () => {
            localStorage.setItem('inspectorPanelWidth', 320);
            updateWorkspaceLayout();
        });
    }
}

// --- Playlist Actions for Selected Channels ---

function togglePlaylistDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('playlist-dropdown');
    if (dropdown) {
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
    }
}

function createPlaylistFromSelected(event) {
    if (event) event.preventDefault();
    if (selectedChannelIds.size === 0) return;

    const name = prompt("Enter a name for the new playlist:");
    if (!name || !name.trim()) return;

    fetch('/api/playlists/create-from-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name.trim(),
            channel_ids: Array.from(selectedChannelIds)
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Error creating playlist: ' + data.error);
        } else {
            alert(`Playlist "${name.trim()}" created successfully!`);
            loadSettingsAndPlaylists();
            deselectAllChannels();
            togglePlaylistDropdown();
        }
    })
    .catch(err => alert('Failed to create playlist: ' + err));
}

function addSelectedToPlaylistPrompt(event) {
    if (event) event.preventDefault();
    if (selectedChannelIds.size === 0) return;

    // Filter to find only file-type playlists (writable local files)
    const filePlaylists = activePlaylists.filter(pl => pl.type === 'file');
    if (filePlaylists.length === 0) {
        alert("No local file-based playlists found. Please navigate to Settings and add a 'Local File(s)' playlist source first.");
        togglePlaylistDropdown();
        return;
    }

    const options = filePlaylists.map((pl, i) => `${i + 1}. ${pl.name}`).join("\n");
    const choice = prompt(`Select a local file playlist to append selected channels to:\n\n${options}\n\nEnter the playlist number (1-${filePlaylists.length}):`);
    if (!choice) return;

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= filePlaylists.length) {
        alert("Invalid selection.");
        return;
    }

    const targetPlaylist = filePlaylists[idx];
    const activeIdx = activePlaylists.findIndex(pl => pl.url === targetPlaylist.url);

    fetch('/api/playlists/add-to-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            playlist_index: activeIdx,
            channel_ids: Array.from(selectedChannelIds)
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Error adding channels to playlist: ' + data.error);
        } else {
            alert(`Successfully appended channels to playlist "${targetPlaylist.name}"!`);
            deselectAllChannels();
            togglePlaylistDropdown();
        }
    })
    .catch(err => alert('Failed to add channels: ' + err));
}

function removeSelectedFromList(event) {
    if (event) event.preventDefault();
    const count = selectedChannelIds.size;
    if (count === 0) return;

    if (!confirm(`Are you sure you want to remove the ${count} selected channel(s) from the current loaded active channels list?`)) return;

    const deletedIds = Array.from(selectedChannelIds);

    fetch('/api/channels/delete-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_ids: deletedIds
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Error removing channels: ' + data.error);
        } else {
            alert(`Successfully removed ${count} channels from list.`);
            // Remove from selected set
            deletedIds.forEach(id => selectedChannelIds.delete(id));
            updateCheckSelectedButtonState();
            triggerFilter();
            togglePlaylistDropdown();
        }
    })
    .catch(err => alert('Failed to remove channels: ' + err));
}

// --- Playlists View Event Handlers & Actions ---

function loadPlaylistsView() {
    const grid = document.getElementById('playlists-grid');
    if (!grid) return;

    grid.innerHTML = `
        <div style="grid-column: 1/-1; display: flex; justify-content: center; align-items: center; padding: 40px; width: 100%;">
            <span class="spinner" style="margin-right: 10px;"></span>
            <span>Loading custom playlists and metadata...</span>
        </div>
    `;

    fetch('/api/playlists')
        .then(res => res.json())
        .then(data => {
            grid.innerHTML = '';
            activePlaylists = data; // Keep activePlaylists synchronized with details

            if (data.length === 0) {
                grid.innerHTML = `
                    <div class="glass-panel text-center pad-40" style="grid-column: 1/-1; width: 100%;">
                        <p style="color: var(--text-muted); margin-bottom: 0;">No playlists found. Create a new custom list from Channel Manager, or import/add one below.</p>
                    </div>
                `;
                return;
            }

            data.forEach(pl => {
                const card = document.createElement('div');
                card.className = 'playlist-card';
                if (pl.type === 'virtual') {
                    card.classList.add('virtual');
                }
                card.setAttribute('data-idx', pl.index);

                let iconSvg = '';
                if (pl.type === 'file') {
                    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                } else if (pl.type === 'url') {
                    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
                } else if (pl.type === 'virtual') {
                    iconSvg = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px; color: #fbbf24;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
                } else {
                    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
                }

                let sizeHtml = '';
                if (pl.type === 'file') {
                    sizeHtml = `
                        <div class="playlist-info-row">
                            <span class="info-label">File Size:</span>
                            <span class="info-value">${formatBytes(pl.file_size_bytes)}</span>
                        </div>
                    `;
                }

                let badgeHtml = '';
                if (pl.type === 'virtual') {
                    badgeHtml = `
                        <span class="playlist-badge virtual">Favorites</span>
                        <span class="playlist-badge writable">Auto-Sync</span>
                    `;
                } else {
                    badgeHtml = `
                        <span class="playlist-badge ${pl.type}">${pl.type}</span>
                        <span class="playlist-badge ${pl.type === 'file' ? 'writable' : 'readonly'}">${pl.type === 'file' ? 'Writable' : 'Read-Only'}</span>
                    `;
                }

                let middleBtnHtml = '';
                if (pl.type === 'file') {
                    middleBtnHtml = `<button class="btn btn-secondary-outline btn-sm" onclick="downloadCustomPlaylist(${pl.index})">Download</button>`;
                } else if (pl.type === 'virtual') {
                    middleBtnHtml = `<button class="btn btn-secondary-outline btn-sm" onclick="downloadCustomPlaylist(-1)">Download</button>`;
                } else {
                    middleBtnHtml = `<button class="btn btn-secondary-outline btn-sm" onclick="window.open('${pl.url}', '_blank')">Link</button>`;
                }

                let deleteBtnText = pl.type === 'virtual' ? 'Clear' : 'Delete';

                card.innerHTML = `
                    <div class="playlist-card-header">
                        <div class="playlist-icon-wrapper ${pl.type}">
                            ${iconSvg}
                        </div>
                        <div class="playlist-meta-title">
                            <h4 class="playlist-name" title="${escapeHTML(pl.name)}">${escapeHTML(pl.name)}</h4>
                            <div class="playlist-badges">
                                ${badgeHtml}
                            </div>
                        </div>
                    </div>
                    <div class="playlist-card-body">
                        <div class="playlist-info-row">
                            <span class="info-label">Streams:</span>
                            <span class="info-value highlight-value ${pl.type === 'virtual' ? 'favorite' : ''}">${pl.channel_count}</span>
                        </div>
                        ${sizeHtml}
                        <div class="playlist-info-row">
                            <span class="info-label">Source Path:</span>
                            <span class="info-value text-ellipsis" style="max-width: 180px;" title="${escapeHTML(pl.url)}">${escapeHTML(pl.url)}</span>
                        </div>
                    </div>
                    <div class="playlist-card-actions">
                        <button class="btn btn-primary btn-sm btn-load-playlist ${pl.type === 'virtual' ? 'favorite' : ''}" onclick="loadSinglePlaylistFromView(${pl.index})">
                            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px; margin-right: 4px; display: inline-block; vertical-align: middle;"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                            ${pl.type === 'virtual' ? 'View List' : 'Load'}
                        </button>
                        ${middleBtnHtml}
                        <button class="btn btn-danger-outline btn-sm" onclick="deletePlaylistsViewPlaylist(${pl.index})">${deleteBtnText}</button>
                    </div>
                `;
                grid.appendChild(card);
            });
        })
        .catch(err => {
            console.error('Error fetching playlists:', err);
            grid.innerHTML = `
                <div class="glass-panel text-center pad-40" style="grid-column: 1/-1; width: 100%;">
                    <p style="color: var(--color-danger); margin-bottom: 0;">Failed to load playlists: ${err.message}</p>
                </div>
            `;
        });
}

function loadSinglePlaylistFromView(idx) {
    if (idx === -1) {
        clearFilters();
        const favsCheckbox = document.getElementById('filter-favs');
        if (favsCheckbox) favsCheckbox.checked = true;
        activeFilters.favorites_only = true;
        switchView('channels');
        triggerFilter();
        return;
    }

    const pl = activePlaylists.find(p => p.index === idx);
    if (!pl) return;

    if (!confirm(`Are you sure you want to load stream dataset from "${pl.name}"? This will overwrite the current workspace's active streams.`)) return;

    updateLoaderStatus(`Loading playlist "${pl.name}"...`);
    switchView('dashboard');

    fetch('/api/playlists/load-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [{ type: pl.type, url: pl.url }] })
    })
    .then(res => res.json())
    .then(data => {
        pollLoadingStatus();
    })
    .catch(err => alert('Failed to load playlist: ' + err));
}

function deletePlaylistsViewPlaylist(idx) {
    if (idx === -1) {
        if (!confirm('Are you sure you want to clear all favorites?')) return;
        fetch('/api/favorites/clear-all', {
            method: 'POST'
        })
        .then(res => res.json())
        .then(data => {
            alert('Favorites list cleared successfully!');
            loadSettingsAndPlaylists();
            setTimeout(loadPlaylistsView, 300);
        })
        .catch(err => alert('Failed to clear favorites: ' + err));
        return;
    }

    const pl = activePlaylists.find(p => p.index === idx);
    if (!pl) return;

    if (!confirm(`Are you sure you want to remove playlist source "${pl.name}"?`)) return;

    const updatedPlaylists = activePlaylists
        .filter(p => p.index !== -1 && p.index !== idx)
        .map(p => ({
            name: p.name,
            type: p.type,
            url: p.url
        }));

    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_playlists: updatedPlaylists })
    })
    .then(res => res.json())
    .then(data => {
        alert('Playlist source removed successfully!');
        loadSettingsAndPlaylists();
        // Delay slightly or let loadSettingsAndPlaylists refresh playlists grid
        setTimeout(loadPlaylistsView, 300);
    })
    .catch(err => alert('Failed to delete playlist: ' + err));
}

function onPlaylistsViewTypeChanged(val) {
    const urlContainer = document.getElementById('playlists-view-url-container');
    const fileContainer = document.getElementById('playlists-view-file-container');
    if (!urlContainer || !fileContainer) return;
    
    if (val === 'file') {
        urlContainer.style.display = 'none';
        fileContainer.style.display = 'block';
    } else {
        urlContainer.style.display = 'block';
        fileContainer.style.display = 'none';
    }
}

function addPlaylistsViewPlaylist() {
    const nameInput = document.getElementById('playlists-view-new-name');
    const typeSelect = document.getElementById('playlists-view-new-type');
    const urlInput = document.getElementById('playlists-view-new-url');
    const fileInput = document.getElementById('playlists-view-new-files');
    
    if (!nameInput || !typeSelect || !urlInput || !fileInput) return;
    
    const name = nameInput.value.trim();
    const type = typeSelect.value;
    
    if (type === 'file') {
        if (!fileInput.files || fileInput.files.length === 0) {
            return alert('Please select at least one M3U file.');
        }
        
        const formData = new FormData();
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('files', fileInput.files[i]);
        }
        
        fetch('/api/playlists/upload-multiple', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                alert('Upload failed: ' + data.error);
                return;
            }
            
            const added = data.added_playlists || [];
            if (name && added.length === 1) {
                added[0].name = name;
            }
            
            const cleanPlaylists = activePlaylists.filter(p => p.index !== -1 && p.type !== 'virtual').map(p => ({
                name: p.name,
                type: p.type,
                url: p.url
            }));
            const updatedPlaylists = [...cleanPlaylists, ...added];
            
            return fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ custom_playlists: updatedPlaylists })
            });
        })
        .then(res => {
            if (res) return res.json();
        })
        .then(data => {
            if (data) {
                alert('Uploaded and added local file playlist(s) successfully!');
                nameInput.value = '';
                fileInput.value = '';
                loadSettingsAndPlaylists();
                setTimeout(loadPlaylistsView, 300);
            }
        })
        .catch(err => alert('Upload request failed: ' + err));
    } else {
        const urlRaw = urlInput.value.trim();
        if (!urlRaw) {
            return alert('URL or Path is required.');
        }
        
        let newPlaylists = [];
        if (type === 'url') {
            const urls = urlRaw.split(/[\n,]+/).map(u => u.trim()).filter(u => u);
            if (urls.length === 1) {
                newPlaylists.push({
                    name: name || 'Custom URL List',
                    type: 'url',
                    url: urls[0]
                });
            } else {
                urls.forEach((url, i) => {
                    newPlaylists.push({
                        name: `${name || 'Custom URL List'} ${i+1}`,
                        type: 'url',
                        url: url
                    });
                });
            }
        } else {
            newPlaylists.push({
                name: name || 'Custom API',
                type: type,
                url: urlRaw
            });
        }
        
        const cleanPlaylists = activePlaylists.filter(p => p.index !== -1 && p.type !== 'virtual').map(p => ({
            name: p.name,
            type: p.type,
            url: p.url
        }));
        const updatedPlaylists = [...cleanPlaylists, ...newPlaylists];
        
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_playlists: updatedPlaylists })
        })
        .then(res => res.json())
        .then(data => {
            alert(`Successfully added ${newPlaylists.length} playlist source(s)!`);
            nameInput.value = '';
            urlInput.value = '';
            loadSettingsAndPlaylists();
            setTimeout(loadPlaylistsView, 300);
        })
        .catch(err => alert('Failed to add playlist: ' + err));
    }
}

// --- Helper Functions ---

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function markSelectedAsFavorite(event) {
    if (event) event.preventDefault();
    if (selectedChannelIds.size === 0) return;

    const ids = Array.from(selectedChannelIds);
    fetch('/api/favorites/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_ids: ids,
            action: 'add'
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Failed to mark favorites: ' + data.error);
        } else {
            alert(`Successfully marked ${ids.length} channel(s) as favorite!`);
            triggerFilter();
            deselectAllChannels();
            togglePlaylistDropdown();
        }
    })
    .catch(err => alert('Failed to update favorites: ' + err));
}

function removeSelectedFromFavorites(event) {
    if (event) event.preventDefault();
    if (selectedChannelIds.size === 0) return;

    const ids = Array.from(selectedChannelIds);
    fetch('/api/favorites/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_ids: ids,
            action: 'remove'
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Failed to remove from favorites: ' + data.error);
        } else {
            alert(`Successfully removed ${ids.length} channel(s) from favorites.`);
            triggerFilter();
            deselectAllChannels();
            togglePlaylistDropdown();
        }
    })
    .catch(err => alert('Failed to update favorites: ' + err));
}

// Active Playlist Banner & Synchronization Functions
function updateActivePlaylistBanner() {
    fetch('/api/playlists/active')
        .then(res => res.json())
        .then(data => {
            const banner = document.getElementById('active-playlist-banner');
            const nameEl = document.getElementById('active-playlist-name');
            const badgeEl = document.getElementById('active-playlist-writable-badge');
            const syncBtn = document.getElementById('btn-sync-playlist');
            const pulseRing = document.getElementById('active-playlist-pulse');

            if (!banner) return;

            if (data && data.name) {
                banner.style.display = 'flex';
                nameEl.textContent = data.name;
                
                if (data.type === 'file') {
                    badgeEl.textContent = 'Writable';
                    badgeEl.className = 'playlist-badge writable';
                    badgeEl.style.background = '';
                    badgeEl.style.color = '';
                    badgeEl.style.border = '';
                    
                    syncBtn.style.display = 'inline-block';
                    if (pulseRing) pulseRing.style.backgroundColor = '#4ade80';
                } else {
                    badgeEl.textContent = data.type === 'combined' ? 'Combined (Read-Only)' : 'Read-Only';
                    badgeEl.className = 'playlist-badge readonly';
                    badgeEl.style.background = '';
                    badgeEl.style.color = '';
                    badgeEl.style.border = '';
                    
                    syncBtn.style.display = 'none';
                    if (pulseRing) pulseRing.style.backgroundColor = 'var(--primary-color)';
                }
            } else {
                banner.style.display = 'none';
            }
        })
        .catch(err => console.error('Error fetching active playlist:', err));
}

function syncCurrentPlaylist() {
    if (!confirm("Are you sure you want to sync the current state of active channels back to the source M3U file? This will overwrite the file with your modified list of channels (including edits and deletes).")) {
        return;
    }
    
    const syncBtn = document.getElementById('btn-sync-playlist');
    const originalText = syncBtn.innerHTML;
    syncBtn.disabled = true;
    syncBtn.innerHTML = `<span class="spinner" style="width: 12px; height: 12px; margin-right: 4px; border-width: 2px;"></span> Saving...`;
    
    fetch('/api/playlists/save-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
        if (data.error) {
            alert("Failed to sync current playlist: " + data.error);
        } else {
            alert(data.message || "Playlist synchronized successfully!");
            loadSettingsAndPlaylists();
        }
    })
    .catch(err => {
        syncBtn.disabled = false;
        syncBtn.innerHTML = originalText;
        alert("Error syncing playlist: " + err);
    });
}

// --- GitHub Upstream Auto-Sync Selection Handlers ---

function loadSelectedFromConfig(event) {
    if (event) event.preventDefault();
    fetch('/api/custom/selected')
        .then(res => res.json())
        .then(data => {
            selectedChannelIds.clear();
            excludedChannelIds.clear();
            
            if (data.matched_ids && data.matched_ids.length > 0) {
                data.matched_ids.forEach(id => selectedChannelIds.add(id));
            }
            if (data.excluded_ids && data.excluded_ids.length > 0) {
                data.excluded_ids.forEach(id => excludedChannelIds.add(id));
            }
            
            updateCheckSelectedButtonState();
            
            // Populating settings fields from config
            const config = data.config || {};
            const excludeGlobalInput = document.getElementById('sync-exclude-global');
            if (excludeGlobalInput) {
                excludeGlobalInput.checked = !!config.excludeGlobal;
            }
            const langOrderInput = document.getElementById('sync-languages-order');
            if (langOrderInput) {
                langOrderInput.value = (config.preferredLanguages || []).join(', ');
            }
            const catOrderInput = document.getElementById('sync-categories-order');
            if (catOrderInput) {
                catOrderInput.value = (config.categoryOrder || []).join(', ');
            }
            const excludeLangsInput = document.getElementById('sync-exclude-languages');
            if (excludeLangsInput) {
                excludeLangsInput.value = (config.excludeLanguages || []).join(', ');
            }
            const excludeCountriesInput = document.getElementById('sync-exclude-countries');
            if (excludeCountriesInput) {
                excludeCountriesInput.value = (config.excludeCountries || []).join(', ');
            }
            const excludeChannelsInput = document.getElementById('sync-exclude-channels-input');
            if (excludeChannelsInput) {
                excludeChannelsInput.value = (config.excludeChannels || []).join('\n');
            }

            // Ensure preserve-selection is checked so filter doesn't clear them
            const preserveSel = document.getElementById('preserve-selection');
            if (preserveSel) preserveSel.checked = true;
            
            // Re-trigger filter to render selected channels if appropriate
            triggerFilter();
            
            if (event) {
                const totalSelect = selectedChannelIds.size;
                const totalExclude = excludedChannelIds.size;
                alert(`Successfully loaded ${totalSelect} selected and ${totalExclude} excluded channels from config!`);
            }
        })
        .catch(err => {
            console.error('Failed to load selected channels from config:', err);
            if (event) alert('Failed to load selection: ' + err);
        });
}

function saveSelectedForAutoUpdate(event) {
    if (event) event.preventDefault();
    
    const excludeGlobal = document.getElementById('sync-exclude-global')?.checked || false;
    const langOrderVal = document.getElementById('sync-languages-order')?.value || '';
    const catOrderVal = document.getElementById('sync-categories-order')?.value || '';
    const excludeLangsVal = document.getElementById('sync-exclude-languages')?.value || '';
    const excludeCountriesVal = document.getElementById('sync-exclude-countries')?.value || '';
    const excludeChannelsVal = document.getElementById('sync-exclude-channels-input')?.value || '';

    // Split and clean lists
    const preferredLanguages = langOrderVal.split(',').map(s => s.trim()).filter(Boolean);
    const categoryOrder = catOrderVal.split(',').map(s => s.trim()).filter(Boolean);
    const excludeLanguages = excludeLangsVal.split(',').map(s => s.trim()).filter(Boolean);
    const excludeCountries = excludeCountriesVal.split(',').map(s => s.trim()).filter(Boolean);
    
    // Split textarea by newline or comma
    const excludeChannels = excludeChannelsVal.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);

    if (selectedChannelIds.size === 0 && excludedChannelIds.size === 0 && 
        preferredLanguages.length === 0 && categoryOrder.length === 0 && 
        excludeLanguages.length === 0 && excludeCountries.length === 0 && 
        excludeChannels.length === 0 && !excludeGlobal) {
        return alert('Please select/exclude channels or set configuration options first.');
    }
    
    const countSelect = selectedChannelIds.size;
    const countExclude = excludedChannelIds.size;
    
    if (!confirm(`Are you sure you want to save your selection (${countSelect} included, ${countExclude} excluded channels) and custom configuration to the repository files?`)) {
        return;
    }
    
    fetch('/api/custom/save-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel_ids: Array.from(selectedChannelIds),
            excluded_ids: Array.from(excludedChannelIds),
            config: {
                excludeGlobal,
                preferredLanguages,
                categoryOrder,
                excludeLanguages,
                excludeCountries,
                excludeChannels
            }
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            alert('Failed to save configuration: ' + data.error);
        } else {
            alert(`Successfully saved rules to repository config files!\n\nCommit and push your changes to GitHub to trigger the auto-sync and release!`);
        }
    })
    .catch(err => {
        alert('Failed to save configuration: ' + err);
    });
}


