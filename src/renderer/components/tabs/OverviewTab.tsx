// tabs/OverviewTab.tsx
import React from 'react';
import { getRelativePath } from '../../../shared/utils';

interface OverviewTabProps {
  selectedFilePaths: string[];
  rootFolder?: string | null;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ selectedFilePaths, rootFolder }) => {
  if (selectedFilePaths.length === 0) {
    return (
      <div className="tab-panel empty-selection">
        <h3>No files selected</h3>
        <p>Use checkboxes in the Explorer to select files for batch operations or comparison.</p>
      </div>
    );
  }

  return (
    <div className="tab-panel overview">
      <div className="selected-files-section">
        <h3>Selected Files ({selectedFilePaths.length})</h3>

        <div className="selected-files-table">
          <div className="table-header">
            <span className="col-name">File Name</span>
            <span className="col-path">Relative Path</span>
          </div>

          <div className="table-body">
            {selectedFilePaths.map((path) => {
              const relPath = getRelativePath(path, rootFolder);
              const name = relPath.split(/[\\/]/).pop() || 'Untitled';

              return (
                <div key={path} className="table-row">
                  <span className="cell-name" title={name}>
                    {name}
                  </span>
                  <span className="cell-path" title={path}>
                    {relPath}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;