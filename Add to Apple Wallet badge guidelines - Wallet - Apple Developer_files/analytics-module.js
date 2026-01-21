"use strict";
/**
 * Click Analytics Module
 * 
 * Provides click tracking for elements with data-aa attributes.
 * Features include:
 * - Automatic click handler attachment on DOM load
 * - Adobe Analytics integration with custom link tracking
 * - Dynamic element detection for delayed or dynamically added content
 * 
 * @version 1.0
 */

(function (window, undefined) {
    
    /**
     * Initializes click tracking for all elements with data-aa attribute
     * Sets up event listeners for each trackable element
     */
    function initializeClickTracking() {
        const trackableElements = document.querySelectorAll('[data-aa]');
        
        if (!trackableElements.length) {
            // console.log("No elements found with data-aa attribute");
            return;
        }

        trackableElements.forEach(function (element) {
            element.addEventListener('click', function(event) {
                handleClick(event, element);
            });
        });
    }

    /**
     * Handles click event for trackable elements
     * @param {Event} event - The click event
     * @param {HTMLElement} element - The clicked element
     */
    function handleClick(event, element) {
        const trackingValue = element.getAttribute('data-aa');
        
        if (!trackingValue) {
            return;
        }

        // Check if Adobe Analytics s object exists
        if (typeof window.s !== 'undefined' && window.s) {
            sendCustomLink(trackingValue);
        } else {
            console.log("Adobe Analytics 's' object not found");
        }
    }

    /**
     * Sends custom link tracking to Adobe Analytics
     * @param {string} linkValue - The tracking value from data-aa attribute
     */
    function sendCustomLink(linkValue) {
        try {
            window.s.eVar54 = document.location.href;
            window.s.prop4 = "D=g";
            window.s.linkTrackVars = "eVar54,prop4";
            window.s.tl(true, 'o', linkValue);
        } catch (error) {
            console.error("Error sending Adobe Analytics custom link:", error);
        }
    }
    /**
     * Handles dynamically added elements using MutationObserver
     */
    function setupDynamicElementObserver() {
        if (window.MutationObserver) {
            const observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach(function (node) {
                            if (node.nodeType === 1) { // Element node
                                // Check if the added node has data-aa attribute
                                if (node.hasAttribute && node.hasAttribute('data-aa')) {
                                    node.addEventListener('click', function(event) {
                                        handleClick(event, node);
                                    });
                                }
                                
                                // Check if it contains elements with data-aa
                                const trackableElements = node.querySelectorAll && node.querySelectorAll('[data-aa]');
                                if (trackableElements && trackableElements.length) {
                                    trackableElements.forEach(function (element) {
                                        element.addEventListener('click', function(event) {
                                            handleClick(event, element);
                                        });
                                    });
                                }
                            }
                        });
                    }
                });
            });

            // Observe the entire document for changes
            observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }
    }

    /**
     * Initializes functionality when DOM is ready
     * @param {Function} fn - Function to execute when DOM is ready
     */
    function domReady(fn) {
        if (document.readyState === "complete" || document.readyState === "interactive") {
            setTimeout(fn, 1);
        } else {
            document.addEventListener("DOMContentLoaded", fn);
        }
    }
    
    // Main initialization when DOM is ready
    domReady(function() {
        initializeClickTracking();
        setupDynamicElementObserver();
    });
    
})(window);