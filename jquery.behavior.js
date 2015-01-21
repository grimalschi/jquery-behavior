(function ($) {
    var rnotwhite = (/\S+/g);
    var rtypenamespace = /^([^.]*)(?:\.(.+)|)/;
    var returnFalse = function () { return false };


    var _ = {};

    _.after = function(times, func) {
        return function() {
            if (--times < 1) {
                return func.apply(this, arguments);
            }
        };
    };

    _.now = Date.now || function() {
        return new Date().getTime();
    };

    _.throttle = function(func, wait, options) {
        var context, args, result;
        var timeout = null;
        var previous = 0;
        if (!options) options = {};
        var later = function() {
            previous = options.leading === false ? 0 : _.now();
            timeout = null;
            result = func.apply(context, args);
            if (!timeout) context = args = null;
        };
        return function() {
            var now = _.now();
            if (!previous && options.leading === false) previous = now;
            var remaining = wait - (now - previous);
            context = this;
            args = arguments;
            if (remaining <= 0 || remaining > wait) {
                clearTimeout(timeout);
                timeout = null;
                previous = now;
                result = func.apply(context, args);
                if (!timeout) context = args = null;
            } else if (!timeout && options.trailing !== false) {
                timeout = setTimeout(later, remaining);
            }
            return result;
        };
    };


    if (!window.console || typeof window.console.log !== 'function') {
        var console = {
            log: function () {}
        };
    }


    var extend = {};

    extend.start = function (data) {
        if (!this.stopped) return this;
        this.stopped = false;
        if (this.onStart) this.onStart(data);
        $(this[this.namespace]).triggerHandler('start');
        if (this.log) {
            if (this.logFn) {
                var args = ['start', this].concat([].slice.call(arguments));
                this.logFn.apply(this, args);
            } else {
                console.log("Behavior", this.namespace, 'start');
            }
        }
        return this;
    };

    extend.stop = function (data) {
        if (this.stopped) return this;
        if (this.onStop) this.onStop(data);
        $(this[this.namespace]).triggerHandler('stop');
        this.stopped = true;
        if (this.log) {
            if (this.logFn) {
                var args = ['stop', this].concat([].slice.call(arguments));
                this.logFn.apply(this, args);
            } else {
                console.log("Behavior", this.namespace, 'stop');
            }
        }
        return this;
    };

    extend.data = function () {
        return {
            namespace: this.namespace,
            records: this.records,
            stopped: this.stopped,
            log: this.log,
            logFn: this.logFn,
            onStart: this.onStart,
            onStop: this.onStop,
            onFire: this.onFire
        };
    };

    extend.logOn = function () {
        this.log = true;
        return this;
    };

    extend.logOff = function () {
        this.log = false;
        return this;
    };

    extend.on = function (data) {
        if (!data.target) return;
        if (!data.types) return;

        // приводим false к returnFalse как делается в jQuery
        if (data.handler === false) data.handler = returnFalse;
        if (!data.handler) return;

        var behavior = this;

        var record = {
            targets: data.target instanceof Function ? [data.target] : $(data.target),
            types: data.types,
            handler: data.handler,
            data: data.data,
            selector: data.selector || undefined,
            bindings: [],
            log: data.log === undefined ? true : !!data.log,
            once: !!data.once,
            after: data.after * 1 || 1,
            calls: 0,
            throttle: data.throttle || {},
            wrapHandler: null,
            behavior: behavior
        };

        // начальная обертка обрабочика
        record.wrapHandler = function () {
            record.calls++;
            if (record.once) behavior.off(record.bindings);
            return record.handler.apply(this, arguments);
        };

        // повторная обертка функцией throttle при необходимости
        if (record.throttle.wait) {
            if (record.throttle.leading === undefined) record.throttle.leading = true;
            if (record.throttle.trailing === undefined) record.throttle.trailing = true;
            record.wrapHandler = _.throttle(record.wrapHandler, record.throttle.wait, record.throttle);
        }

        // и еще одна обертка, если указан after
        if (record.after > 1) record.wrapHandler = _.after(record.after, record.wrapHandler);

        // разделяем строку с событиями на отдельные события, и проходимся по ним
        var typelist = record.types.match(rnotwhite);
        for (var i = 0; i < typelist.length; i++) {
            var match = rtypenamespace.exec(typelist[i]);
            if (!match) continue;

            var type = match[1];
            var namespaces = (match[2] || "").split(".");

            if (namespaces.length === 1 && namespaces[0] === '') {
                namespaces = [];
            }

            namespaces.push(behavior.namespace);

            // затем проходимся по кадому элементу, которому требуется назначить событие
            for (var j = 0; j < record.targets.length; j++) {
                // событие назначается только объектам и функциям
                if (typeof record.targets[j] === 'object') {
                    if (!$.acceptData(record.targets[j])) continue;
                } else if (typeof record.targets[j] !== 'function') continue;

                var binding = {
                    target: record.targets[j],
                    fulltype: type + '.' + namespaces.join('.'),
                    selector: record.selector,
                    data: record.data,
                    handler: null,
                    type: type,
                    namespaces: namespaces,
                    paused: false,
                    log: record.log,
                    calls: 0,
                    record: record
                };

                // последняя обертка обрабочика, которая следит за паузами, выводит лог и т.д.
                binding.handler = function () {
                    if (binding.paused || behavior.stopped) return;
                    var before = record.calls;
                    var result = record.wrapHandler.apply(this, arguments);
                    if (before === record.calls) return;
                    binding.calls++;
                    if (behavior.onFire) behavior.onFire.call(this, arguments);
                    if (behavior.log && record.log && binding.log) {
                        if (behavior.logFn) {
                            var args = ['fire', behavior].concat([].slice.call(arguments));
                            behavior.logFn.apply(behavior, args);
                        } else {
                            console.log("Behavior", behavior.namespace, binding);
                        }
                    }
                    return result;
                };

                // сохраняем ссылку на биндинг в функции обработчике,
                // используется при клонировании элемента с событиями
                binding.handler.binding = binding;

                // если элемент, которому мы назначаем событие - функция,
                // то событие назначается на поле объекта-функции,
                // благодаря чему события можно назначать на функции
                if (binding.target instanceof Function) {
                    binding.target[behavior.namespace] = binding.target[behavior.namespace] || {};
                    var bindTarget = binding.target[behavior.namespace];
                } else {
                    var bindTarget = binding.target;
                }

                $.event.add(bindTarget, binding.fulltype, binding.handler, binding.data, binding.selector);

                record.bindings.push(binding);
            }
        }

        if (record.bindings.length) this.records.push(record);

        return this;
    };

    extend.one = function (data) {
        data.once = true;
        return this.on(data);
    };

    extend.cloneBinding = function (binding, target) {
        // функция практически 1 в 1 повторяет код из extend.on

        var record = binding.record;
        var behavior = record.behavior;

        var binding2 = {
            target: target,
            fulltype: binding.fulltype,
            selector: binding.selector,
            data: binding.data,
            handler: function (event) {
                if (binding2.paused || behavior.stopped) return;
                var before = record.calls;
                var result = record.wrapHandler.apply(this, arguments);
                if (before === record.calls) return;
                binding2.calls++;
                if (behavior.onFire) behavior.onFire(event);
                if (behavior.log && record.log && binding2.log) {
                    if (behavior.logFn) {
                        var args = ['fire', behavior].concat(arguments);
                        behavior.logFn.apply(behavior, args);
                    } else {
                        console.log("Behavior", behavior.namespace, binding2);
                    }
                }
                return result;
            },
            type: binding.type,
            namespaces: binding.namespaces,
            paused: binding.paused,
            log: binding.log,
            calls: 0,
            record: record
        };

        binding2.handler.binding = binding2;

        if (binding2.target instanceof Function) {
            binding2.target[behavior.namespace] = binding2.target[behavior.namespace] || {};
            var bindTarget = binding2.target[behavior.namespace];
        } else {
            var bindTarget = binding2.target;
        }

        $.event.add(bindTarget, binding2.fulltype, binding2.handler, binding2.data, binding2.selector);

        record.bindings.push(binding2);
    };

    extend.filter = function (data) {
        data = data || {};

        // результат фильтрации сюда помещен будет
        var bindings = [];

        // обработка filter() или filter({})
        if (!('target' in data) && !('types' in data) && !('handler' in data) && !('selector' in data)) {
            for (var i = 0; i < this.records.length; i++) {
                [].push.apply(bindings, this.records[i].bindings);
            }
            return bindings;
        }

        // данные, по которым будет проводиться фильтрация
        var check = {
            targets: data.target,
            types: null,
            handler: data.handler,
            selector: data.selector
        };

        if ('target' in data && !(data.target instanceof $)) {
            check.targets = $(data.target);
        }

        // если указаны типы событий, то приводим их к удобному для фильтрации виду
        if (typeof data.types === 'string' && data.types) {
            check.types = [];
            var typelist = data.types.match(rnotwhite) || [];
            for (var i = 0; i < typelist.length; i++) {
                var match = rtypenamespace.exec(typelist[i]);
                if (!match) continue;
                check.types.push({
                    type: match[1],
                    namespaces: match[2] && match[2].length ? match[2].split(".") : []
                });
            }
        }

        // обработка пустого фильтра
        if (!check.targets && !check.types && !check.handler) {
            return bindings;
        }

        // начинаем фильтрацию по всем записям
        for (var k = 0; k < this.records.length; k++) {
            var record = this.records[k];

            // проверка селектора для делегирования событий
            if (check.selector) {
                if (check.selector === '**') {
                    if (!record.selector) continue;
                } else if (check.selector !== record.selector) continue;
            }

            // проверяем каждый биндинг
            for (var l = 0; l < record.bindings.length; l++) {
                var binding = record.bindings[l];

                // если указан точный обработчик, то сразу фильтруем события по нему,
                // проверяем как исходную функцию, так и функцию-обертку, поскольку
                // передаваться могут обе в разных ситуациях
                if (check.handler && check.handler !== record.handler && check.handler !== binding.handler) {
                    // исключение - если обработчики разные, но у них поле guid одинаковое
                    if (!check.handler.guid || (check.handler.guid !== record.handler.guid
                                                && check.handler.guid !== binding.handler.guid)) continue;
                }

                // проверяем, есть ли элемент с событием в списке
                if (check.targets) {
                    var checkTarget = false;
                    for (var j = 0; j < check.targets.length; j++) {
                        if (check.targets[j] === binding.target) {
                            checkTarget = true;
                            break;
                        }
                    }
                    if (!checkTarget) continue;
                }

                // так же проверяем каждое событие в списке, сравнивая его с биндингом
                if (check.types && check.types.length) {
                    var checkType = false;
                    for (var h = 0; h < check.types.length; h++) {
                        // если имя не подходит, неймспейсы не смотрим
                        if (check.types[h].type && check.types[h].type !== binding.type) continue;

                        // проверка неймспейсов проваливается, если хоть один требуемый отсутствует
                        var checkNamespaces = true;
                        for (var t = 0; t < check.types[h].namespaces.length; t++) {
                            if (binding.namespaces.indexOf(check.types[h].namespaces[t]) < 0) {
                                checkNamespaces = false;
                            }
                        }

                        if (checkNamespaces) {
                            // если название события подходит, и все нужные неймспейсы присутствуют,
                            // то сразу отмечаем биндинг как подходящий фильтрам
                            checkType = true;
                            break;
                        }
                    }
                    if (!checkType) continue;
                }

                bindings.push(binding);
            }
        }

        return bindings;
    };

    extend.off = function () {
        if (arguments.length === 0) {
            return this.off(this.filter());
        }

        var data = arguments[0];
        if (data instanceof Array) {
            for (var i = data.length - 1; i >= 0; i--) {
                var binding = data[i];

                var bindTarget = typeof binding.target === 'function'
                    ? binding.target[this.namespace]
                    : binding.target;

                // внутри $.event.remove может быть вызов $.cleanData, который вызывает
                // $.event.remove, и начинаются проблемы, поэтому используем флаг для
                // предотвращения подобных зацикливаний
                if (binding.removing) continue;
                binding.removing = true;

                $.event.remove(bindTarget, binding.fulltype, binding.handler, binding.selector);

                binding.record.bindings.splice(binding.record.bindings.indexOf(binding), 1);

                if (!binding.record.bindings.length) {
                    this.records.splice(this.records.indexOf(binding.record), 1);
                }
            }
            return this;
        } else if (data instanceof Object) {
            return this.off(this.filter(data));
        } else if (typeof data === 'string') {
            return this.off({ types: data });
        }

        return this;
    };

    extend.fastOff = function (target) {
        var bindings = [];

        for (var i = 0; i < this.records.length; i++) {
            for (var j = 0; j < this.records[i].bindings.length; j++) {
                if (this.records[i].bindings[j].target === target) {
                    bindings.push(this.records[i].bindings[j]);
                }
            }
        }

        return this.off(bindings);
    };

    extend.pause = function () {
        if (arguments.length === 0) {
            for (var i = 0; i < this.records.length; i++) {
                this.pause(this.records[i].bindings);
            }
            return this;
        }

        var data = arguments[0];
        if (data instanceof Array) {
            for (var i = 0; i < data.length; i++) {
                data[i].paused = true;
            }
            return this;
        } else if (data instanceof Object) {
            return this.pause(this.filter(data));
        }

        return this;
    };

    extend.resume = function () {
        if (arguments.length === 0) {
            for (var i = 0; i < this.records.length; i++) {
                this.resume(this.records[i].bindings);
            }
            return this;
        }

        var data = arguments[0];
        if (data instanceof Array) {
            for (var i = 0; i < data.length; i++) {
                data[i].paused = false;
            }
            return this;
        } else if (data instanceof Object) {
            return this.resume(this.filter(data));
        }

        return this;
    };

    extend.destroy = function () {
        this.stop();
        this.off();
        behaviors.splice(behaviors.indexOf(this), 1);
    };


    var prototype = {};

    prototype.on = function(types, selector, data, fn, one) {
        // Types can be a map of types/handlers
        if (typeof types === "object") {
            // (types-Object, selector, data)
            if (typeof selector !== "string") {
                // (types-Object, data)
                data = data || selector;
                selector = undefined;
            }
            for (var type in types) {
                this.on(type, selector, data, types[type], one);
            }
            return this;
        }

        if (data == null && fn == null) {
            // (types, fn)
            fn = selector;
            data = selector = undefined;
        } else if (fn == null) {
            if (typeof selector === "string") {
                // (types, selector, fn)
                fn = data;
                data = undefined;
            } else {
                // (types, data, fn)
                fn = data;
                data = selector;
                selector = undefined;
            }
        }

        if (fn === false) {
            fn = returnFalse;
        } else if (!fn) {
            return this;
        }

        this.behavior.on({
            target: this.target,
            types: types,
            selector: selector,
            data: data,
            handler: fn,
            once: one
        });

        return this;
    };

    prototype.one = function(types, selector, data, fn) {
        return this.on(types, selector, data, fn, 1);
    };

    prototype.trigger = function(type, data) {
        return this.target.each(function() {
            jQuery.event.trigger(type, data, this);
        });
    };

    prototype.triggerHandler = function(type, data) {
        var elem = this.target[0];
        if (elem) {
            return jQuery.event.trigger(type, data, elem, true);
        }
    };

    prototype.off = function(types, selector, fn) {
        if ( types && types.preventDefault && types.handleObj ) {
            // (event)  dispatched jQuery.Event
            var handleObj = types.handleObj;
            this.behavior.off({
                target: types.delegateTarget,
                types: handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
                selector: handleObj.selector,
                handler: handleObj.handler
            });
            return this;
        }

        if (typeof types === "object") {
            // (types-object [, selector])
            for (var type in types) {
                this.off(type, selector, types[type]);
            }
            return this;
        }

        if (selector === false || typeof selector === "function") {
            // (types [, fn])
            fn = selector;
            selector = undefined;
        }
        if (fn === false) {
            fn = returnFalse;
        }

        this.behavior.off({
            target: this.target,
            types: types,
            selector: selector,
            handler: fn
        });

        return this;
    };

    $.each(("blur focus focusin focusout load resize scroll unload click dblclick " +
            "mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change " +
            "select submit keydown keypress keyup error contextmenu").split(" "), function(i, name) {
        prototype[name] = function(data, fn) {
            return arguments.length > 0
                ? this.on(name, null, data, fn)
                : this.trigger(name);
        };
    });

    prototype.hover = function(fnOver, fnOut) {
        return this.mouseenter(fnOver).mouseleave(fnOut || fnOver);
    };

    prototype.bind = function(types, data, fn) {
        return this.on(types, null, data, fn);
    };

    prototype.unbind = function(types, fn) {
        return this.off(types, null, fn);
    };

    prototype.delegate = function(selector, types, data, fn) {
        return this.on(types, selector, data, fn);
    };

    prototype.undelegate = function(selector, types, fn) {
        // (namespace) or (selector, types [, fn])
        return arguments.length === 1 ? this.off(selector, "**") : this.off(types, selector || "**", fn);
    };


    var behaviors = [];
    var namespaces = {};

    $.Behavior = function (data) {
        if (!data || typeof data !== 'object') data = {};

        var behavior = function (selector) {
            return new wrap(selector);
        };

        if (!data.namespace) data.namespace = 'bhvr';

        if (namespaces[data.namespace]) {
            namespaces[data.namespace]++;
            data.namespace = data.namespace + '-' + namespaces[data.namespace];
        } else {
            namespaces[data.namespace] = 1;
        }

        $.extend(behavior, extend, {
            log: !!data.log,
            namespace: data.namespace,
            stopped: true,
            records: [],
            onStart: typeof data.onStart === 'function' ? data.onStart : null,
            onStop: typeof data.onStop === 'function' ? data.onStop : null,
            onFire: typeof data.onFire === 'function' ? data.onFire : null,
            logFn: typeof data.logFn === 'function' ? data.logFn : null
        });

        var wrap = function (selector, context) {
            this.target = selector instanceof Function ? [selector] : $(selector, context);
            this.behavior = behavior;
            return this;
        };

        wrap.prototype = prototype;

        if (data.active !== false) behavior.start();

        behaviors.push(behavior);

        return behavior;
    };


    // патчим $.event.add, чтобы отслеживать копирование событий при клонировании элемента
    var origEventAdd = $.event.add;
    $.event.add = function (elem, types, handler, data, selector) {
        // вместо функции handler может передаваться объект, хранящий данные события,
        // у которого есть поле handler, которое и является функцией-обрабочиком.
        if (handler.handler && handler.handler.binding) {
            var binding = handler.handler.binding;
            return binding.record.behavior.cloneBinding(binding, elem);
        }

        return origEventAdd.apply($.event, arguments);
    };

    // патчим $.fn.off, чтобы отслеживать отключение событий стандартным способом jQuery
    var origOff = $.fn.off;
    $.fn.off = function (types, selector, fn) {
        for (var i = 0; i < behaviors.length; i++) {
            behaviors[i](this).off(types, selector, fn);
        }

        return origOff.apply(this, arguments);
    };

    // патчим $.cleanData, чтобы отслеживать отключения событий при очистке данных
    var origCleanData = $.cleanData;
    $.cleanData = function(elems, acceptData) {
        for (var i = 0; i < behaviors.length; i++) {
            for (var j = 0; j < elems.length; j++) {
                behaviors[i].fastOff(elems[j]);
            }
        }

        return origCleanData.apply($, arguments);
    };
}(jQuery));