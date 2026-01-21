(function() {
    if (typeof window.document.querySelectorAll !== 'function') {
      return false;
    }
  
    // Function to check if the device has a retina display
    function isRetina() {
      var query = '(-webkit-min-device-pixel-ratio: 1.5),' +
                  '(min--moz-device-pixel-ratio: 1.5),' +
                  '(-o-min-device-pixel-ratio: 3/2),' +
                  '(min-device-pixel-ratio: 1.5),' +
                  '(min-resolution: 144dpi),' +
                  '(min-resolution: 1.5dppx)';
  
      return (window.devicePixelRatio > 1 || (window.matchMedia && window.matchMedia(query).matches));
    }
  
    // Function to locate elements with specific data attribute
    function locateElements(root, selector, dataAttr) {
      return Array.from(root.querySelectorAll(selector + '[data-' + dataAttr + ']:not([data-' + dataAttr + '="' + exclude_value + '"])'));
    }
  
    // Function to process images, videos, or CSS backgrounds
    function processElements(elements, property, isVideo) {
      elements.forEach(function(element) {
        var original = isVideo ? element.getAttribute('poster') : element.getAttribute('src') || element.style[property];
        
        var url = document.createElement('a');
        url.href = original;
  
        var dot = url.pathname.lastIndexOf('.');
        var filetype = url.pathname.substr((~-dot >>> 0) + 2);
        var filename = url.pathname.substring(url.pathname.lastIndexOf('/') + 1, dot);
        var isRetina = filename.slice(retina_tag.length * -1) === retina_tag;
  
        if (!isRetina && image_types.indexOf(filetype) !== -1) {
          url.pathname = url.pathname.substr(0, dot) + retina_tag + '.' + filetype;
  
          if (isVideo) {
            element.setAttribute('poster', url);
          } else {
            if (element.tagName.toLowerCase() === 'img') {
              element.setAttribute('src', url);
            } else {
              element.style[property] = 'url("' + url + '")';
            }
          }
  
          element.setAttribute('data-' + data_tag + '-status', status_replaced);
        }
      });
    }
  
    // Configuration options
    var auto_retinate = true;
    var data_tag = 'hires';
    var exclude_value = false;
    var force_retina = false;
    var image_types = ['jpg', 'png', 'gif'];
    var retina_tag = '_2x';
    var status_pending = 'pending';
    var status_replaced = 'replaced';
  
    // Function to retinate
    function retinate(root) {
      if (isRetina() || force_retina) {
        var images = locateElements(root, 'img', data_tag);
        var videos = locateElements(root, 'video[poster]', data_tag);
        var backgrounds = locateElements(root, '*', data_tag);
  
        processElements(images, 'src', false);
        processElements(videos, 'poster', true);
        processElements(backgrounds, 'background-image', false);
      }
    }
  
    // Initialization on document ready
    document.addEventListener('DOMContentLoaded', function() {
      if (auto_retinate) {
        retinate(document.body);
      }
    });
  
    // Initialization on window load
    window.addEventListener('load', function() {
      if (auto_retinate) {
        retinate(document.body);
      }
    });
  })();
  