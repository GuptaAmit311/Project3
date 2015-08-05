'use strict';

SwaggerEditor.controller('PreviewCtrl', function PreviewCtrl(Storage, Builder,
  ASTManager, Editor, BackendHealthCheck, FocusedPath, TagManager, Preferences,
  $scope, $rootScope, $stateParams, $sessionStorage) {

  $sessionStorage.$default({securityKeys: {}});
  var securityKeys = $sessionStorage.securityKeys;
  var SparkMD5 = (window.SparkMD5);

  /**
   * Reacts to updates of YAML in storage that usually triggered by editor
   * changes
  */
  function update(latest, force) {
    if (!Preferences.get('liveRender') && !force && $scope.specs) {
      $rootScope.isDirty = true;
      Storage.save('progress',  'progress-unsaved');
      return;
    }

    ASTManager.refresh(latest);

    // If backend is not healthy don't update
    if (!BackendHealthCheck.isHealthy()) {
      return;
    }

    // Error can come in success callback, because of recursive promises
    // So we install same handler for error and success
    Builder.buildDocs(latest).then(onBuildSuccess, onBuildFailure);
  }

  /**
   * General callback for builder results
  */
  function onBuild(result) {
    var sortOptions = {};
    if (angular.isString($stateParams.tags)) {
      sortOptions.limitToTags = $stateParams.tags.split(',');
    }

    refreshTags(result.specs);

    $scope.specs = result.specs;

    if ($scope.specs && $scope.specs.securityDefinitions) {
      _.forEach($scope.specs.securityDefinitions, function (security, key) {
        securityKeys[key] = SparkMD5.hash(JSON.stringify(security));
      });
    }
    $scope.errors = result.errors;
    $scope.warnings = result.warnings;
  }

  /**
   * Callback of builder success
  */
  function onBuildSuccess(result) {
    onBuild(result);
    $scope.errors = null;
    Storage.save('progress',  'success-process');

    Editor.clearAnnotation();

    if (angular.isArray(result.warnings)) {
      result.warnings.forEach(function (warning) {
        Editor.annotateSwaggerError(warning, 'warning');
      });
    }
  }

  /**
   * Callback of builder failure
  */
  function onBuildFailure(result) {
    onBuild(result);

    if (angular.isArray(result.errors)) {
      if (result.errors[0].yamlError) {
        Editor.annotateYAMLErrors(result.errors[0].yamlError);
        Storage.save('progress', 'error-yaml');
      } else if (result.errors.length) {
        Storage.save('progress', 'error-swagger');
        result.errors.forEach(Editor.annotateSwaggerError);
      } else {
        Storage.save('progress', 'error-general');
      }
    } else {
      Storage.save('progress', 'error-general');
    }
  }

  Storage.addChangeListener('yaml', update);

  $scope.loadLatest = function () {
    Storage.load('yaml').then(function (latest) {
      update(latest, true);
    });
    $rootScope.isDirty = false;
  };

  // If app is in preview mode, load the yaml from storage
  if ($rootScope.mode === 'preview') {
    $scope.loadLatest();
  }

  ASTManager.onFoldStatusChanged(function () {
    _.defer(function () { $scope.$apply(); });
  });
  $scope.isCollapsed = ASTManager.isFolded;
  $scope.isAllFolded = ASTManager.isAllFolded;
  $scope.toggle = function (path) {
    ASTManager.toggleFold(path, Editor);
  };
  $scope.toggleAll = function (path) {
    ASTManager.setFoldAll(path, true, Editor);
  };

  $scope.tagIndexFor = TagManager.tagIndexFor;
  $scope.getAllTags = TagManager.getAllTags;
  $scope.getCurrentTags = TagManager.getCurrentTags;
  $scope.stateParams = $stateParams;

  function refreshTags(specs) {
    if (angular.isObject(specs)) {
      TagManager.registerTagsFromSpecs(specs);
    }
  }

  /**
   * Focuses editor to a line that represents that path beginning
   * @param {AngularEvent} $event - angular event
   * @param {array} path - an array of keys into specs structure
   * @param {int} offset - Because of some bugs in AST generated by
   *   yaml-js, sometime generated line number is not accurate. this
   *   is used to adjust that. FIXME: it should get removed once bugs
   *   in yaml-js is fixed.
   * that points out that specific node
  */
  $scope.focusEdit = function ($event, path, offset) {

    $event.stopPropagation();

    var line = ASTManager.lineForPath(path);

    offset = offset || 0;
    Editor.gotoLine(line - offset);
    Editor.focus();
  };

  /**
   * Returns true if operation is the operation in focus
   * in the editor
   * @returns {boolean}
  */
  $scope.isInFocus = function (path) {
    return !!path; //FocusedPath.isInFocus(path);
  };

  /**
   * get a subpath for edit
   * @param  {string} pathName
   * @return {string} edit path
   */
  $scope.getEditPath = function (pathName) {
    return '#/paths?path=' + window.encodeURIComponent(pathName);
  };

  /**
   * Response CSS class for an HTTP response code
   *
   * @param {number} code - The HTTP Response CODE
   *
   * @returns {string} - CSS class to be applied to the response code HTML tag
  */
  $scope.responseCodeClassFor = function (code) {
    var result = 'default';
    switch (Math.floor(+code / 100)) {
      case 2:
        result = 'green';
        break;
      case 5:
        result = 'red';
        break;
      case 4:
        result = 'yellow';
        break;
      case 3:
        result = 'blue';
    }
    return result;
  };

  /**
   * Determines if a key is a vendor extension key
   * Vendor extensions always start with `x-`
   *
   * @param {string} key
   *
   * @returns {boolean}
  */
  function isVendorExtension(key) {
    return _.startsWith(key, 'x-');
  }

  $scope.isVendorExtension = isVendorExtension;

  /**
   * Determines if we should render the definitions sections
   *
   * @param {object|null} - the definitions object of Swagger spec
   *
   * @return {boolean} - true if definitions object should be rendered, false
   *  otherwise
  */
  $scope.showDefinitions = function (definitions) {
    return angular.isObject(definitions);
  };

  /**
   * Determines if an operation should be shown or not
   * @param  {object} operation     the operation object
   * @param  {string} operationName the operation name in path hash
   * @return {boolean}              true if the operation should be shown
   */
  function showOperation(operation, operationName) {
    var currentTagsLength = TagManager.getCurrentTags() &&
      TagManager.getCurrentTags().length;

    if (isVendorExtension(operationName)) {
      return false;
    }

    if (operationName === 'parameters') {
      return false;
    }

    if (!currentTagsLength) {
      return true;
    }

    return operation.tags && operation.tags.length &&
      _.intersection(TagManager.getCurrentTags(), operation.tags).length;
  }

  $scope.showOperation = showOperation;

  /**
   * Determines if apath should be shown or not
   * @param  {object} path     the path object
   * @param  {string} pathName the path name in paths hash
   * @return {boolean}         true if the path should be shown
   */
  $scope.showPath = function (path, pathName) {
    if (isVendorExtension(pathName)) {
      return false;
    }

    return _.some(path, showOperation);

  };
});