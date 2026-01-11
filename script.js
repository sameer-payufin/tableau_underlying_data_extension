document.addEventListener('DOMContentLoaded', function () {
    let dashboard;
    let selectedWorksheet;
    let availableColumns = [];
    let distinctValuesCache = {};
    let useSummaryDataOnly = false; // Track if worksheet only supports summary data
    let activeDataSource = null; // Store data source for direct access
    let activeLogicalTableId = null; // Store logical table ID

    const statusMsg = document.getElementById('status-message');
    const worksheetSelect = document.getElementById('sheet-select');
    const columnCheckboxes = document.getElementById('column-checkboxes');
    const columnSearch = document.getElementById('column-search');
    const selectedCountEl = document.getElementById('selected-count');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const filtersContainer = document.getElementById('filters-container');
    const addFilterBtn = document.getElementById('add-filter-btn');
    const downloadBtn = document.getElementById('download-btn');
    const previewBtn = document.getElementById('preview-btn');
    const previewContainer = document.getElementById('preview-container');

    function log(msg) {
        console.log(msg);
    }

    log("Script loaded.");

    if (typeof tableau === 'undefined') {
        statusMsg.textContent = "Error: Tableau library not loaded.";
        return;
    }

    // Initialize Tableau Extensions API
    tableau.extensions.initializeAsync().then(function () {
        log("initializeAsync resolved.");

        if (!tableau.extensions.dashboardContent) {
            statusMsg.textContent = "Error: Not in a Dashboard.";
            return;
        }

        dashboard = tableau.extensions.dashboardContent.dashboard;
        log("Dashboard found: " + dashboard.name);

        const worksheets = dashboard.worksheets;

        // Clear loading option
        worksheetSelect.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.text = "Select a Worksheet";
        defaultOption.disabled = true;
        defaultOption.selected = true;
        worksheetSelect.appendChild(defaultOption);

        // Populate Worksheet Dropdown
        worksheets.forEach(function (worksheet) {
            const option = document.createElement('option');
            option.value = worksheet.name;
            option.text = worksheet.name;
            worksheetSelect.appendChild(option);
        });

        statusMsg.textContent = `Found ${worksheets.length} worksheets.`;

    }, function (err) {
        statusMsg.textContent = "Error initializing: " + err.toString();
    });

    // Handle Worksheet Change
    worksheetSelect.addEventListener('change', async function () {
        const worksheetName = worksheetSelect.value;
        selectedWorksheet = dashboard.worksheets.find(ws => ws.name === worksheetName);

        downloadBtn.disabled = true;
        previewBtn.disabled = true;
        addFilterBtn.disabled = true;
        statusMsg.textContent = 'Loading columns...';
        columnCheckboxes.innerHTML = '<p class="placeholder-text">Loading...</p>';
        columnSearch.value = '';
        filtersContainer.innerHTML = '';
        previewContainer.innerHTML = '';
        distinctValuesCache = {};
        useSummaryDataOnly = false; // Reset flag for new worksheet
        activeDataSource = null;
        activeLogicalTableId = null;

        // Try getUnderlyingDataAsync first
        try {
            const dataTable = await selectedWorksheet.getUnderlyingDataAsync({ maxRows: 1, includeAllColumns: true });
            
            availableColumns = dataTable.columns.map(c => c.fieldName);
            console.log("Worksheet columns:", availableColumns);
            
            populateColumnCheckboxes(availableColumns);
            updateSelectedCount();
            addFilterBtn.disabled = false;
            downloadBtn.disabled = false;
            previewBtn.disabled = false;
            statusMsg.textContent = `Ready. ${availableColumns.length} columns found.`;
            
        } catch (underlyingErr) {
            console.log("Underlying data failed, trying data source directly:", underlyingErr.message);
            
            // Try to get underlying data from the data source directly
            let gotDataSourceColumns = false;
            try {
                const dataSources = await selectedWorksheet.getDataSourcesAsync();
                
                if (dataSources.length > 0) {
                    const dataSource = dataSources[0];
                    const logicalTables = await dataSource.getLogicalTablesAsync();
                    
                    // Try each logical table until one succeeds
                    for (let i = 0; i < logicalTables.length && !gotDataSourceColumns; i++) {
                        try {
                            const tableId = logicalTables[i].id;
                            const dsData = await dataSource.getUnderlyingDataAsync({ 
                                maxRows: 1,
                                logicalTableId: tableId
                            });
                            
                            availableColumns = dsData.columns.map(c => c.fieldName);
                            console.log("Data source columns from table", i, ":", availableColumns);
                            
                            useSummaryDataOnly = 'datasource'; // Special mode: use data source
                            activeDataSource = dataSource;
                            activeLogicalTableId = tableId;
                            populateColumnCheckboxes(availableColumns);
                            updateSelectedCount();
                            addFilterBtn.disabled = false;
                            downloadBtn.disabled = false;
                            previewBtn.disabled = false;
                            statusMsg.textContent = `Ready. ${availableColumns.length} columns found (from data source).`;
                            gotDataSourceColumns = true;
                        } catch (tableErr) {
                            console.log(`Logical table ${i} failed:`, tableErr.message);
                        }
                    }
                }
            } catch (dsErr) {
                console.log("Data source access failed:", dsErr.message);
            }
            
            // If data source didn't work, fall back to summary data
            if (!gotDataSourceColumns) {
                try {
                    const summaryTable = await selectedWorksheet.getSummaryDataAsync({ maxRows: 1 });
                    
                    useSummaryDataOnly = true; // Mark that this worksheet only supports summary data
                    availableColumns = summaryTable.columns.map(c => c.fieldName);
                    console.log("Summary columns:", availableColumns);
                    
                    populateColumnCheckboxes(availableColumns);
                    updateSelectedCount();
                    addFilterBtn.disabled = false;
                    downloadBtn.disabled = false;
                    previewBtn.disabled = false;
                    statusMsg.textContent = `⚠️ Summary data only (${availableColumns.length} cols). Tip: Add a base field to Detail shelf for full data.`;
                    
                } catch (summaryErr) {
                    console.error("Both underlying and summary data failed:", summaryErr);
                    statusMsg.textContent = 'Error: ' + underlyingErr.message;
                }
            }
        }
    });

    // Populate column checkboxes
    function populateColumnCheckboxes(columns) {
        columnCheckboxes.innerHTML = '';
        
        columns.forEach(function (columnName, index) {
            const item = document.createElement('div');
            item.className = 'checkbox-item';
            item.dataset.columnName = columnName.toLowerCase();
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `col-${index}`;
            checkbox.value = columnName;
            checkbox.checked = true;
            checkbox.addEventListener('change', function() {
                updateSelectedCount();
                updateFilterDropdowns();
            });
            
            const label = document.createElement('label');
            label.htmlFor = `col-${index}`;
            label.textContent = columnName;
            
            item.appendChild(checkbox);
            item.appendChild(label);
            columnCheckboxes.appendChild(item);
        });
    }

    // Search columns
    columnSearch.addEventListener('input', function () {
        const searchTerm = columnSearch.value.toLowerCase();
        const items = columnCheckboxes.querySelectorAll('.checkbox-item');
        
        items.forEach(function (item) {
            const columnName = item.dataset.columnName;
            if (columnName.includes(searchTerm)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    });

    // Update selected count
    function updateSelectedCount() {
        const count = getSelectedColumns().length;
        selectedCountEl.textContent = `${count} columns selected`;
    }

    // Select All columns (visible only)
    selectAllBtn.addEventListener('click', function () {
        const items = columnCheckboxes.querySelectorAll('.checkbox-item');
        items.forEach(function (item) {
            if (item.style.display !== 'none') {
                item.querySelector('input').checked = true;
            }
        });
        updateSelectedCount();
        updateFilterDropdowns();
    });

    // Deselect All columns (visible only)
    deselectAllBtn.addEventListener('click', function () {
        const items = columnCheckboxes.querySelectorAll('.checkbox-item');
        items.forEach(function (item) {
            if (item.style.display !== 'none') {
                item.querySelector('input').checked = false;
            }
        });
        updateSelectedCount();
        updateFilterDropdowns();
    });

    // Add Filter Row
    addFilterBtn.addEventListener('click', function () {
        addFilterRow();
    });

    function addFilterRow() {
        const selectedCols = getSelectedColumns();
        if (selectedCols.length === 0) {
            statusMsg.textContent = 'Please select at least one column first.';
                return;
            }
            
        const filterRow = document.createElement('div');
        filterRow.className = 'filter-row';
        
        // Field select - only selected columns
        const fieldSelect = document.createElement('select');
        fieldSelect.className = 'filter-field';
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.text = 'Select Field';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;
        fieldSelect.appendChild(defaultOpt);
        
        selectedCols.forEach(function (col) {
            const opt = document.createElement('option');
            opt.value = col;
            opt.text = col;
            fieldSelect.appendChild(opt);
        });
        
        // Value container
        const valueContainer = document.createElement('div');
        valueContainer.className = 'value-container';
        
        // Selected values display
        const selectedDisplay = document.createElement('div');
        selectedDisplay.className = 'selected-values-display';
        selectedDisplay.textContent = 'Select field first';
        
        // Dropdown panel
        const dropdownPanel = document.createElement('div');
        dropdownPanel.className = 'value-dropdown-panel';
        dropdownPanel.style.display = 'none';
        
        // Search input
        const valueSearch = document.createElement('input');
        valueSearch.type = 'text';
        valueSearch.className = 'value-search';
        valueSearch.placeholder = 'Search values...';
        
        // Select/Deselect buttons
        const btnContainer = document.createElement('div');
        btnContainer.className = 'value-btn-container';
        
        const selectAllValuesBtn = document.createElement('button');
        selectAllValuesBtn.type = 'button';
        selectAllValuesBtn.className = 'tiny-btn';
        selectAllValuesBtn.textContent = 'Select All';
        
        const deselectAllValuesBtn = document.createElement('button');
        deselectAllValuesBtn.type = 'button';
        deselectAllValuesBtn.className = 'tiny-btn';
        deselectAllValuesBtn.textContent = 'Deselect All';
        
        btnContainer.appendChild(selectAllValuesBtn);
        btnContainer.appendChild(deselectAllValuesBtn);
        
        // Checkboxes container
        const checkboxesContainer = document.createElement('div');
        checkboxesContainer.className = 'value-checkboxes';
        checkboxesContainer.innerHTML = '<p class="placeholder-text">Select a field first</p>';
        
        dropdownPanel.appendChild(valueSearch);
        dropdownPanel.appendChild(btnContainer);
        dropdownPanel.appendChild(checkboxesContainer);
        
        // Toggle dropdown on click
        selectedDisplay.addEventListener('click', function() {
            if (checkboxesContainer.children.length > 0 && !checkboxesContainer.querySelector('.placeholder-text')) {
                dropdownPanel.style.display = dropdownPanel.style.display === 'none' ? 'block' : 'none';
            }
        });
        
        // Search functionality
        valueSearch.addEventListener('input', function() {
            const searchTerm = valueSearch.value.toLowerCase();
            const items = checkboxesContainer.querySelectorAll('.value-checkbox-item');
            items.forEach(item => {
                const label = item.querySelector('label').textContent.toLowerCase();
                item.style.display = label.includes(searchTerm) ? 'flex' : 'none';
            });
        });
        
        // Select All visible values
        selectAllValuesBtn.addEventListener('click', function() {
            const items = checkboxesContainer.querySelectorAll('.value-checkbox-item');
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input').checked = true;
                }
            });
            updateSelectedDisplay(checkboxesContainer, selectedDisplay);
        });
        
        // Deselect All visible values
        deselectAllValuesBtn.addEventListener('click', function() {
            const items = checkboxesContainer.querySelectorAll('.value-checkbox-item');
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input').checked = false;
                }
            });
            updateSelectedDisplay(checkboxesContainer, selectedDisplay);
        });
        
        valueContainer.appendChild(selectedDisplay);
        valueContainer.appendChild(dropdownPanel);
        
        // When field is selected, load distinct values
        fieldSelect.addEventListener('change', function() {
            const fieldName = fieldSelect.value;
            if (fieldName) {
                selectedDisplay.textContent = 'Loading...';
                valueSearch.value = '';
                loadDistinctValuesWithCheckboxes(fieldName, checkboxesContainer, selectedDisplay);
            }
        });
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-filter-btn';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', function () {
            filterRow.remove();
        });
        
        filterRow.appendChild(fieldSelect);
        filterRow.appendChild(valueContainer);
        filterRow.appendChild(removeBtn);
        filtersContainer.appendChild(filterRow);
    }
    
    function updateSelectedDisplay(checkboxesContainer, selectedDisplay) {
        const checked = checkboxesContainer.querySelectorAll('input:checked');
        if (checked.length === 0) {
            selectedDisplay.textContent = 'Click to select values';
        } else if (checked.length === 1) {
            selectedDisplay.textContent = checked[0].value;
        } else {
            selectedDisplay.textContent = `${checked.length} values selected`;
        }
    }
    
    // Load distinct values as checkboxes
    async function loadDistinctValuesWithCheckboxes(fieldName, checkboxesContainer, selectedDisplay) {
        checkboxesContainer.innerHTML = '<p class="placeholder-text">Loading...</p>';
        
        try {
            // Check cache first
            if (distinctValuesCache[fieldName]) {
                populateValueCheckboxes(checkboxesContainer, distinctValuesCache[fieldName], selectedDisplay);
                return;
            }
            
            const distinctValues = new Set();

            if (useSummaryDataOnly === 'datasource' && activeDataSource && activeLogicalTableId) {
                // Use data source directly
                const dsData = await activeDataSource.getUnderlyingDataAsync({
                    logicalTableId: activeLogicalTableId
                });
                const columns = dsData.columns.map(c => c.fieldName);
                const colIndex = columns.indexOf(fieldName);
                
                if (colIndex === -1) {
                    selectedDisplay.textContent = 'Column not found';
                return;
            }
            
                for (const row of dsData.data) {
                    const cell = row[colIndex];
                    const value = cell ? String(cell.formattedValue || '') : '';
                    if (value) {
                        distinctValues.add(value);
                    }
                }
            } else if (useSummaryDataOnly === true) {
                // Use summary data for worksheets that don't support underlying data
                const summaryTable = await selectedWorksheet.getSummaryDataAsync();
                const columns = summaryTable.columns.map(c => c.fieldName);
                const colIndex = columns.indexOf(fieldName);
                
                if (colIndex === -1) {
                    selectedDisplay.textContent = 'Column not found';
                    return;
                }
                
                for (const row of summaryTable.data) {
                    const cell = row[colIndex];
                    const value = cell ? String(cell.formattedValue || '') : '';
                    if (value) {
                        distinctValues.add(value);
                    }
                }
            } else {
                // Use DataTableReader to get ALL underlying data
                const pageSize = 10000;
                const dataTableReader = await selectedWorksheet.getUnderlyingTableDataReaderAsync(
                    pageSize,
                    { includeAllColumns: true }
                );

                const totalPages = dataTableReader.pageCount;
                let columns = null;
                let colIndex = -1;

                for (let page = 0; page < totalPages; page++) {
                    const dataTable = await dataTableReader.getPageAsync(page);
                    
                    if (!columns) {
                        columns = dataTable.columns.map(c => c.fieldName);
                        colIndex = columns.indexOf(fieldName);
                        if (colIndex === -1) {
                            await dataTableReader.releaseAsync();
                            selectedDisplay.textContent = 'Column not found';
                            return;
                        }
                    }
                    
                    for (const row of dataTable.data) {
                        const cell = row[colIndex];
                        const value = cell ? String(cell.formattedValue || '') : '';
                        if (value) {
                            distinctValues.add(value);
                        }
                    }
                    
                    selectedDisplay.textContent = `Loading... (${distinctValues.size} values)`;
                }

            await dataTableReader.releaseAsync();
            }
            
            const sortedValues = Array.from(distinctValues).sort((a, b) => 
                a.localeCompare(b, undefined, { numeric: true })
            );
            distinctValuesCache[fieldName] = sortedValues;
            
            populateValueCheckboxes(checkboxesContainer, sortedValues, selectedDisplay);
            
        } catch (err) {
            console.error("Error loading distinct values:", err);
            selectedDisplay.textContent = 'Error loading';
        }
    }
    
    function populateValueCheckboxes(container, values, selectedDisplay) {
        container.innerHTML = '';
        
        values.forEach(function(val, idx) {
            const item = document.createElement('div');
            item.className = 'value-checkbox-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `val-${Date.now()}-${idx}`;
            checkbox.value = val;
            checkbox.addEventListener('change', function() {
                updateSelectedDisplay(container, selectedDisplay);
            });
            
            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.textContent = val;
            
            item.appendChild(checkbox);
            item.appendChild(label);
            container.appendChild(item);
        });
        
        selectedDisplay.textContent = `Click to select (${values.length} values)`;
    }


    // Update existing filter dropdowns when column selection changes
    function updateFilterDropdowns() {
        const selectedCols = getSelectedColumns();
        const filterRows = filtersContainer.querySelectorAll('.filter-row');
        
        filterRows.forEach(function (row) {
            const fieldSelect = row.querySelector('.filter-field');
            const currentValue = fieldSelect.value;
            
            // Clear and repopulate
            fieldSelect.innerHTML = '';
            
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.text = 'Select Field';
            defaultOpt.disabled = true;
            fieldSelect.appendChild(defaultOpt);
            
            selectedCols.forEach(function (col) {
                const opt = document.createElement('option');
                opt.value = col;
                opt.text = col;
                if (col === currentValue) {
                    opt.selected = true;
                }
                fieldSelect.appendChild(opt);
            });
            
            // If previous value not in new list, reset
            if (!selectedCols.includes(currentValue)) {
                fieldSelect.value = '';
            }
        });
    }

    // Get selected columns
    function getSelectedColumns() {
        const checkboxes = columnCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    // Get active filters (multi-select)
    function getActiveFilters() {
        const filters = [];
        const filterRows = filtersContainer.querySelectorAll('.filter-row');
        
        filterRows.forEach(function (row) {
            const field = row.querySelector('.filter-field').value;
            const checkedBoxes = row.querySelectorAll('.value-checkboxes input:checked');
            const values = Array.from(checkedBoxes).map(cb => cb.value.toLowerCase());
            
            if (field && values.length > 0) {
                filters.push({ field, values });
            }
        });
        
        return filters;
    }

    // Handle Download Click
    downloadBtn.addEventListener('click', function () {
        downloadFilteredData();
    });

    // Handle Preview Click
    previewBtn.addEventListener('click', function () {
        previewData();
    });

    async function previewData() {
        if (!selectedWorksheet) return;

        const selectedCols = getSelectedColumns();
        if (selectedCols.length === 0) {
            statusMsg.textContent = 'Please select at least one column.';
            return;
        }

        const filters = getActiveFilters();
        statusMsg.textContent = 'Fetching data for preview...';
        previewContainer.innerHTML = '';
        previewBtn.disabled = true;
        downloadBtn.disabled = true;

        try {
            let allData = [];
            let columns = null;

            if (useSummaryDataOnly === 'datasource' && activeDataSource && activeLogicalTableId) {
                // Use data source directly
                const dsData = await activeDataSource.getUnderlyingDataAsync({
                    logicalTableId: activeLogicalTableId
                });
                columns = dsData.columns;
                allData = dsData.data;
            } else if (useSummaryDataOnly === true) {
                // Use summary data for worksheets that don't support underlying data
                const summaryTable = await selectedWorksheet.getSummaryDataAsync();
                columns = summaryTable.columns;
                allData = summaryTable.data;
                console.log(`Fetched ${allData.length} rows from summary data for preview`);
            } else {
                // Use DataTableReader to fetch ALL underlying data
                const pageSize = 10000;
                const dataTableReader = await selectedWorksheet.getUnderlyingTableDataReaderAsync(
                    pageSize,
                    { includeAllColumns: true }
                );

                const totalRows = dataTableReader.totalRowCount;
                const totalPages = dataTableReader.pageCount;

                for (let page = 0; page < totalPages; page++) {
                    const dataTable = await dataTableReader.getPageAsync(page);
                    if (!columns) {
                        columns = dataTable.columns;
                    }
                    allData = allData.concat(dataTable.data);
                    statusMsg.textContent = `Loading: ${allData.length} / ${totalRows} rows...`;
                }

                await dataTableReader.releaseAsync();
                console.log(`Fetched ${allData.length} rows for preview`);
            }
            
            renderPreviewTable({ columns, data: allData }, selectedCols, filters);
            previewBtn.disabled = false;
            downloadBtn.disabled = false;
            
        } catch (err) {
            console.error("Error fetching preview:", err);
            statusMsg.textContent = 'Error: ' + err.message;
            previewBtn.disabled = false;
            downloadBtn.disabled = false;
        }
    }

    function renderPreviewTable(dataTable, selectedCols, filters) {
        const allColumns = dataTable.columns.map(c => c.fieldName);
        
        // Get indices for selected columns
        const selectedIndices = [];
        const colsToShow = [];
        selectedCols.forEach(col => {
            const idx = allColumns.indexOf(col);
            if (idx !== -1) {
                selectedIndices.push(idx);
                colsToShow.push(col);
            }
        });
        
        // Get indices for filter columns (multi-select, case-insensitive)
        const filterConfigs = filters.map(f => ({
            index: allColumns.indexOf(f.field),
            values: f.values // already lowercase
        })).filter(f => f.index !== -1);

        let html = '<table><thead><tr>';
        colsToShow.forEach(col => html += `<th>${col}</th>`);
        html += '</tr></thead><tbody>';

        let rowCount = 0;
        const maxPreviewRows = 10;

        for (let i = 0; i < dataTable.data.length && rowCount < maxPreviewRows; i++) {
            const row = dataTable.data[i];
            
            // Apply filters (multi-select - value must be in selected values)
            let includeRow = true;
            for (const filter of filterConfigs) {
                const cell = row[filter.index];
                const cellValue = cell ? String(cell.formattedValue || '').toLowerCase() : '';
                
                if (!filter.values.includes(cellValue)) {
                    includeRow = false;
                    break;
                }
            }

            if (includeRow) {
                rowCount++;
            html += '<tr>';
                selectedIndices.forEach(function (idx) {
                    const cell = row[idx];
                    const value = cell ? cell.formattedValue : '';
                    html += `<td>${value}</td>`;
            });
            html += '</tr>';
            }
        }

        html += '</tbody></table>';
        previewContainer.innerHTML = html;
        statusMsg.textContent = `Preview: ${rowCount} rows shown. ${colsToShow.length} columns.`;
    }

    async function downloadFilteredData() {
        if (!selectedWorksheet) return;

        const selectedCols = getSelectedColumns();
        if (selectedCols.length === 0) {
            statusMsg.textContent = 'Please select at least one column.';
            return;
        }

        const userFilters = getActiveFilters();

        statusMsg.textContent = 'Fetching all data...';
        downloadBtn.disabled = true;
        previewBtn.disabled = true;

        try {
            let allData = [];
            let columns = null;

            if (useSummaryDataOnly === 'datasource' && activeDataSource && activeLogicalTableId) {
                // Use data source directly
                const dsData = await activeDataSource.getUnderlyingDataAsync({
                    logicalTableId: activeLogicalTableId
                });
                columns = dsData.columns;
                allData = dsData.data;
                statusMsg.textContent = `Processing ${allData.length} rows (from data source)...`;
            } else if (useSummaryDataOnly === true) {
                // Use summary data for worksheets that don't support underlying data
                const summaryTable = await selectedWorksheet.getSummaryDataAsync();
                columns = summaryTable.columns;
                allData = summaryTable.data;
                console.log(`Fetched ${allData.length} rows from summary data for download`);
                statusMsg.textContent = `Processing ${allData.length} rows (summary data)...`;
            } else {
                // Use DataTableReader to get ALL rows (no 10k limit)
                const pageSize = 10000;
                const dataTableReader = await selectedWorksheet.getUnderlyingTableDataReaderAsync(
                    pageSize,
                    { includeAllColumns: true }
                );

                const totalRows = dataTableReader.totalRowCount;
                const totalPages = dataTableReader.pageCount;
                console.log(`Total rows: ${totalRows}, Pages: ${totalPages}`);
                statusMsg.textContent = `Found ${totalRows} rows. Fetching...`;

                // Fetch all pages
                for (let page = 0; page < totalPages; page++) {
                                const dataTable = await dataTableReader.getPageAsync(page);

                                if (!columns) {
                                    columns = dataTable.columns;
                                }

                                allData = allData.concat(dataTable.data);
                    statusMsg.textContent = `Fetching: ${allData.length} / ${totalRows} rows...`;
                }

                // Release the reader
                        await dataTableReader.releaseAsync();

                console.log(`Fetched ${allData.length} total rows`);
                statusMsg.textContent = `Processing ${allData.length} rows...`;
            }

            processAndDownload({ columns, data: allData }, selectedCols, userFilters);

        } catch (err) {
            console.error("Error fetching data:", err);
            statusMsg.textContent = 'Error: ' + err.message;
            downloadBtn.disabled = false;
            previewBtn.disabled = false;
        }
    }

    function processAndDownload(dataTable, selectedCols, userFilters) {
        const allColumns = dataTable.columns.map(c => c.fieldName);
        
        // Debug: Log available columns
        console.log("=== DOWNLOAD DEBUG ===");
        console.log("Columns from DataReader:", allColumns);
        console.log("Selected columns:", selectedCols);
        console.log("Filters:", userFilters);
        
        // Build case-insensitive column map
        const columnMap = {};
        allColumns.forEach((col, idx) => {
            columnMap[col.toLowerCase()] = { name: col, index: idx };
        });
        
        // Get indices for selected columns (case-insensitive match)
        const selectedIndices = [];
        const actualCols = [];
        selectedCols.forEach(col => {
            const match = columnMap[col.toLowerCase()];
            if (match) {
                selectedIndices.push(match.index);
                actualCols.push(match.name);
            } else {
                console.log(`Column not found: "${col}"`);
            }
        });

        // Get indices for user filter columns (multi-select, case-insensitive)
        const filterConfigs = [];
        userFilters.forEach(f => {
            const match = columnMap[f.field.toLowerCase()];
            if (match) {
                filterConfigs.push({
                    index: match.index,
                    field: f.field,
                    values: f.values // already lowercase
                });
                console.log(`Filter: ${f.field} (index ${match.index}) in [${f.values.join(', ')}]`);
            } else {
                console.log(`Filter column not found: "${f.field}"`);
            }
        });

        const rows = [];

        // Header row with only selected columns
        rows.push(actualCols.map(escapeCSV).join(','));

        let matchCount = 0;
        let debuggedFirst = false;

        for (const row of dataTable.data) {
            // Apply user filters
            let includeRow = true;
            
            for (const filter of filterConfigs) {
                const cell = row[filter.index];
                const cellValue = cell ? String(cell.formattedValue || cell.value || '').toLowerCase() : '';
                
                // Debug first few rows
                if (!debuggedFirst && filter.field.toLowerCase().includes('application')) {
                    console.log(`Sample cell for ${filter.field}:`, cell, `| Value: "${cellValue}"`);
                }
                
                // Multi-select match (value must be in selected values)
                if (!filter.values.includes(cellValue)) {
                    includeRow = false;
                    break;
                }
            }
            
            if (!debuggedFirst && dataTable.data.indexOf(row) < 3) {
                // Keep checking first 3 rows for debug
            } else {
                debuggedFirst = true;
            }

            if (includeRow) {
                matchCount++;
                // Only include selected columns
                const rowData = selectedIndices.map(idx => {
                    const cell = row[idx];
                    return escapeCSV(cell ? (cell.formattedValue || cell.value || '') : '');
                });
                rows.push(rowData.join(','));
            }
        }

        console.log(`Matched ${matchCount} out of ${dataTable.data.length} rows`);

        if (matchCount === 0 && userFilters.length > 0) {
            statusMsg.textContent = `No matching records found. Check browser console (F12) for debug info.`;
            downloadBtn.disabled = false;
            previewBtn.disabled = false;
            return;
        }

        const csvContent = rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${selectedWorksheet.name}_Data.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        statusMsg.textContent = `Downloaded ${matchCount} rows, ${actualCols.length} columns.`;
        downloadBtn.disabled = false;
        previewBtn.disabled = false;
    }

    function escapeCSV(str) {
        if (str === null || str === undefined) return "";
        str = String(str).replace(/"/g, '""');
        if (str.search(/("|,|\n|\r)/g) >= 0) {
            str = `"${str}"`;
        }
        return str;
    }

});
