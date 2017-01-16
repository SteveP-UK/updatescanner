import {Fuzzy} from './fuzzy';
import {PageStore} from 'page/page_store';
import {Page} from 'page/page';

/**
 * Static functions to scan a list of webpages and test for updates.
 */
export class Scan {
  /**
   * Start scanning the pages one at a time. HTML is checked for updates and
   * saved to the PageStore, and the Page objects updated and saved accordingly.
   *
   * @param {Array.<Page>} pageList - Array of pages to scan.
   *
   * @returns {Promise} An empty promise that fulfills once all pages have been
   * scanned and updated.
   */
  static scan(pageList) {
    // Construct a chain of Promises to scan each Page sequentially.
    let promiseChain = Promise.resolve(null);
    pageList.forEach((page) => {
      // The 'then' clause needs a dummy parameter to keep the chain sequential.
      promiseChain = promiseChain.then((_) => {
        return Scan._scanPage(page);
      });
    });
    return promiseChain;
  }

  /**
   * Scan a single page, check for updates, then save the HTML to the PageStore
   * and updating and save the Page object accordingly. Errors are logged and
   * ignored.
   *
   * @param {Page} page - Page to scan.
   *
   * @returns {Promise} Promise that fulfils once the page has been scanned and
   * updated.
   */
  static _scanPage(page) {
    // Function to check the status of a fetch response.
    const checkStatus = function(response) {
      if (response.ok) {
        return Promise.resolve(response);
      } else {
        return Promise.reject('[' + response.status + '] '
                              + response.statusText);
      }
    };

    return fetch(page.url)
      .then(checkStatus)
      .then((response) => response.text())
      .then((html) => Scan._processHtml(page, html))
      .catch((error) => {
        console.log('Could not scan "' + page.title + '": ' + error);
        page.error = true;
        page.errorMessage = error;
      });
  }

  /**
   * Load the "NEW" HTML from storage, compare it with the the scanned HTML,
   * update the page state and update the HTML storage as necessary. returns
   * without waiting for the save operations to complete.
   * Note that the "NEW" HTML is used for comparison - this is the HTML that was
   * downloaded during the most recent scan. This is the simplest and most
   * resource-efficient approach.
   *
   * @param {Page} page - Page object to update.
   * @param {string} scannedHtml - HTML to process.
   */
  static _processHtml(page, scannedHtml) {
    PageStore.loadHtml(page.id, PageStore.htmlTypes.NEW).then((prevHtml) => {
      Scan._updatePageState(page, prevHtml, scannedHtml);
    });
  }

  /**
   * Compare the scanned HTML with the "NEW" HTML from storage, update the page
   * state and save the HTML to storage. The method returns without waiting for
   * the save operations to complete.
   *
   * @param {Page} page - Page object to update.
   * @param {string} prevHtml - HTML from storage.
   * @param {string} scannedHtml - Scanned HTML to process.
   */
  static _updatePageState(page, prevHtml, scannedHtml) {
    switch (Scan._getChangeType(prevHtml, scannedHtml, page.changeThreshold)) {
      case Scan.changeEnum.NEW_CONTENT:
      case Scan.changeEnum.MINOR_CHANGE:
        PageStore.saveHtml(page.id, PageStore.htmlTypes.NEW, scannedHtml);
        // Only update the state if not previously marked as changed.
        if (page.state != Page.stateEnum.CHANGED) {
          page.state = Page.stateEnum.NO_CHANGE;
        }
        break;

      case Scan.changeEnum.MAJOR_CHANGE:
        if (page.state != Page.stateEnum.CHANGED) {
          // This is a newly detected change, so update the old HTML.
          PageStore.saveHtml(page.id, PageStore.htmlTypes.OLD, prevHtml);
        }
        PageStore.saveHtml(page.id, PageStore.htmlTypes.NEW, scannedHtml);
        page.state = Page.stateEnum.CHANGED;
        break;

      case Scan.changeEnum.NO_CHANGE:
        // Only update the state if not previously marked as changed.
        if (page.state != Page.stateEnum.CHANGED) {
          page.state = Page.stateEnum.NO_CHANGE;
        }
        break;
    }
    page.error = false;
    page.errorMessage = '';

    // Commit changes, but don't wait for the save to complete
    page.save();
  }

  /**
   * Given two downloaded HTML strings, return a changeEnum value indicating how
   * similar they are.
   *
   * @param {string} html1 - First HTML string for comparison.
   * @param {string} html2 - Second HTML string for comparison.
   * @param {integer} changeThreshold - Number of characters that must change to
   * indicate a major change.
   *
   * @returns {string} Scan.changeEnum string indicating how similar the
   * two HTML strings are.
   */
  static _getChangeType(html1, html2, changeThreshold) {
    if (html1 == '') {
      // This is the first scan.
      return Scan.changeEnum.NEW_CONTENT;
    } else if (html1 == html2) {
      // HTML is unchanged.
      return Scan.changeEnum.NO_CHANGE;
    } else if (Fuzzy.isMajorChange(html1, html2, changeThreshold)) {
      // Change is larger than changeThreshold.
      return Scan.changeEnum.MAJOR_CHANGE;
    } else {
      // Change is smaller than changeThreshold.
      return Scan.changeEnum.MINOR_CHANGE;
    }
  }

  /**
   * @returns {string} Enumeration indicating the similarity of two HTML
   * strings.
   */
  static get changeEnum() {
    return {NEW_CONTENT: 'new_content',
            NO_CHANGE: 'no_change',
            MAJOR_CHANGE: 'major_change',
            MINOR_CHANGE: 'minor_change',
          };
  }
}