#!/usr/bin/env python3
"""Regenerate WatchQA.xcodeproj (project.pbxproj + schemes).

Two platform families share the same Swift sources:

  watchOS  WatchQAHost    / WatchQARunner      bundle $(WATCHQA_BUNDLE_PREFIX)[.runner]
  iOS      WatchQAHostiOS / WatchQARunneriOS   bundle $(WATCHQA_BUNDLE_PREFIX).ios[.runner]

Run after adding/removing a source file:  python3 runner/generate_project.py
Signing team and bundle prefix are build settings passed by `watchqa` (DEVELOPMENT_TEAM,
WATCHQA_BUNDLE_PREFIX), never stored in the project.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.join(HERE, "WatchQA.xcodeproj")

HOST_SOURCES = ["HostApp.swift"]
RUNNER_SOURCES = ["WatchQARunner.swift", "Commands.swift", "Elements.swift", "Mailbox.swift"]

_next = [0x100]


def oid():
    _next[0] += 1
    return "WQ%022X" % _next[0]


objs = []  # (id, one-line definition)


def add(id_, body):
    objs.append((id_, "\t\t%s = %s;" % (id_, body)))


def settings(d):
    return "{" + " ".join("%s = %s;" % (k, v) for k, v in d.items()) + "}"


# ---------- project-level ----------
P, PCL, PD, PR = "WQ0000000000000000000001", oid(), oid(), oid()
G0, GH, GR, GP = oid(), oid(), oid(), oid()

common = {
    "SWIFT_VERSION": "5.0",
    "CODE_SIGN_STYLE": "Automatic",
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "WATCHQA_BUNDLE_PREFIX": "dev.watchqa.local",
    "MARKETING_VERSION": "0.2.0",
    "CURRENT_PROJECT_VERSION": "1",
}
debug = {**common, "ONLY_ACTIVE_ARCH": "YES", "DEBUG_INFORMATION_FORMAT": "dwarf", "SWIFT_OPTIMIZATION_LEVEL": '"-Onone"', "ENABLE_TESTABILITY": "YES"}

add(PCL, "{isa = XCConfigurationList; buildConfigurations = (%s, %s); defaultConfigurationName = Debug;}" % (PD, PR))
add(PD, "{isa = XCBuildConfiguration; name = Debug; buildSettings = %s;}" % settings(debug))
add(PR, "{isa = XCBuildConfiguration; name = Release; buildSettings = %s;}" % settings(common))

# ---------- source files (shared by every target) ----------
file_ref = {}
for f in HOST_SOURCES + RUNNER_SOURCES:
    file_ref[f] = oid()
    add(file_ref[f], '{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = "<group>";}' % f)

products = []  # product file refs


def build_file(f):
    b = oid()
    add(b, "{isa = PBXBuildFile; fileRef = %s;}" % file_ref[f])
    return b


def family(suffix, platform_settings, host_bundle, runner_bundle, host_extra):
    host_name, runner_name = "WatchQAHost" + suffix, "WatchQARunner" + suffix
    host_prod, runner_prod = oid(), oid()
    add(host_prod, "{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = %s.app; sourceTree = BUILT_PRODUCTS_DIR;}" % host_name)
    add(runner_prod, "{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = %s.xctest; sourceTree = BUILT_PRODUCTS_DIR;}" % runner_name)
    products.extend([host_prod, runner_prod])

    host_t, host_cl, host_d, host_r = oid(), oid(), oid(), oid()
    host_src, host_fw, host_res = oid(), oid(), oid()
    run_t, run_cl, run_d, run_r = oid(), oid(), oid(), oid()
    run_src, run_fw, dep, proxy = oid(), oid(), oid(), oid()

    host_settings = {
        **platform_settings,
        "PRODUCT_NAME": '"$(TARGET_NAME)"',
        "PRODUCT_BUNDLE_IDENTIFIER": host_bundle,
        "GENERATE_INFOPLIST_FILE": "YES",
        "INFOPLIST_KEY_CFBundleDisplayName": "WatchQA",
        "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/Frameworks"',
        **host_extra,
    }
    runner_settings = {
        **platform_settings,
        "PRODUCT_NAME": '"$(TARGET_NAME)"',
        "PRODUCT_BUNDLE_IDENTIFIER": runner_bundle,
        "GENERATE_INFOPLIST_FILE": "YES",
        "TEST_TARGET_NAME": host_name,
        "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"',
    }

    host_files = " ".join(build_file(f) + "," for f in HOST_SOURCES)
    run_files = " ".join(build_file(f) + "," for f in RUNNER_SOURCES)
    add(host_t, "{isa = PBXNativeTarget; buildConfigurationList = %s; buildPhases = (%s, %s, %s); buildRules = (); dependencies = (); name = %s; productName = %s; productReference = %s; productType = \"com.apple.product-type.application\";}" % (host_cl, host_src, host_fw, host_res, host_name, host_name, host_prod))
    add(host_cl, "{isa = XCConfigurationList; buildConfigurations = (%s, %s); defaultConfigurationName = Debug;}" % (host_d, host_r))
    add(host_d, "{isa = XCBuildConfiguration; name = Debug; buildSettings = %s;}" % settings(host_settings))
    add(host_r, "{isa = XCBuildConfiguration; name = Release; buildSettings = %s;}" % settings(host_settings))
    add(host_src, "{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (%s); runOnlyForDeploymentPostprocessing = 0;}" % host_files)
    add(host_fw, "{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;}")
    add(host_res, "{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;}")
    add(run_t, "{isa = PBXNativeTarget; buildConfigurationList = %s; buildPhases = (%s, %s); buildRules = (); dependencies = (%s); name = %s; productName = %s; productReference = %s; productType = \"com.apple.product-type.bundle.ui-testing\";}" % (run_cl, run_src, run_fw, dep, runner_name, runner_name, runner_prod))
    add(run_cl, "{isa = XCConfigurationList; buildConfigurations = (%s, %s); defaultConfigurationName = Debug;}" % (run_d, run_r))
    add(run_d, "{isa = XCBuildConfiguration; name = Debug; buildSettings = %s;}" % settings(runner_settings))
    add(run_r, "{isa = XCBuildConfiguration; name = Release; buildSettings = %s;}" % settings(runner_settings))
    add(run_src, "{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (%s); runOnlyForDeploymentPostprocessing = 0;}" % run_files)
    add(run_fw, "{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;}")
    add(dep, "{isa = PBXTargetDependency; target = %s; targetProxy = %s;}" % (host_t, proxy))
    add(proxy, "{isa = PBXContainerItemProxy; containerPortal = %s; proxyType = 1; remoteGlobalIDString = %s; remoteInfo = %s;}" % (P, host_t, host_name))
    return {"host": (host_t, host_name), "runner": (run_t, runner_name)}


watch = family(
    "",
    {
        "SDKROOT": "watchos",
        "SUPPORTED_PLATFORMS": '"watchos watchsimulator"',
        "WATCHOS_DEPLOYMENT_TARGET": "10.0",
        "TARGETED_DEVICE_FAMILY": "4",
    },
    '"$(WATCHQA_BUNDLE_PREFIX)"',
    '"$(WATCHQA_BUNDLE_PREFIX).runner"',
    {"INFOPLIST_KEY_WKWatchOnly": "YES", "INFOPLIST_KEY_WKApplication": "YES"},
)
ios = family(
    "iOS",
    {
        "SDKROOT": "iphoneos",
        "SUPPORTED_PLATFORMS": '"iphoneos iphonesimulator"',
        "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
        "TARGETED_DEVICE_FAMILY": "1",
        "SUPPORTS_MACCATALYST": "NO",
        "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
    },
    '"$(WATCHQA_BUNDLE_PREFIX).ios"',
    '"$(WATCHQA_BUNDLE_PREFIX).ios.runner"',
    {"INFOPLIST_KEY_UILaunchScreen_Generation": "YES", "INFOPLIST_KEY_UIApplicationSceneManifest_Generation": "YES"},
)

# ---------- groups + project ----------
host_group_children = ", ".join(file_ref[f] for f in HOST_SOURCES)
runner_group_children = ", ".join(file_ref[f] for f in RUNNER_SOURCES)
add(G0, '{isa = PBXGroup; children = (%s, %s, %s); sourceTree = "<group>";}' % (GH, GR, GP))
add(GH, '{isa = PBXGroup; children = (%s); path = Host; sourceTree = "<group>";}' % host_group_children)
add(GR, '{isa = PBXGroup; children = (%s); path = Runner; sourceTree = "<group>";}' % runner_group_children)
add(GP, '{isa = PBXGroup; children = (%s); name = Products; sourceTree = "<group>";}' % ", ".join(products))
targets = [watch["host"][0], watch["runner"][0], ios["host"][0], ios["runner"][0]]
test_attrs = "".join("%s = {TestTargetID = %s;}; " % (fam["runner"][0], fam["host"][0]) for fam in (watch, ios))
add(P, '{isa = PBXProject; buildConfigurationList = %s; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = %s; productRefGroup = %s; projectDirPath = ""; projectRoot = ""; targets = (%s); attributes = {LastUpgradeCheck = 2600; TargetAttributes = {%s};};}' % (PCL, G0, GP, ", ".join(targets), test_attrs))

# project.pbxproj lists objects sorted by id for stable diffs
body = "\n".join(line for _, line in sorted(objs))
pbx = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n%s\n\t};\n\trootObject = %s;\n}\n" % (body, P)
os.makedirs(PROJ, exist_ok=True)
with open(os.path.join(PROJ, "project.pbxproj"), "w") as f:
    f.write(pbx)


def ref(bid, name, bp):
    return '<BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "%s" BuildableName = "%s" BlueprintName = "%s" ReferencedContainer = "container:WatchQA.xcodeproj"/>' % (bid, name, bp)


def scheme(fam):
    (ht, hn), (rt, rn) = fam["host"], fam["runner"]
    return """<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2600" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "NO" buildForArchiving = "NO" buildForAnalyzing = "NO">
            %s
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "NO">
      <Testables>
         <TestableReference skipped = "NO">
            %s
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" debugDocumentVersioning = "YES" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         %s
      </BuildableProductRunnable>
   </LaunchAction>
</Scheme>
""" % (ref(ht, hn + ".app", hn), ref(rt, rn + ".xctest", rn), ref(ht, hn + ".app", hn))


scheme_dir = os.path.join(PROJ, "xcshareddata", "xcschemes")
os.makedirs(scheme_dir, exist_ok=True)
for fam in (watch, ios):
    with open(os.path.join(scheme_dir, fam["runner"][1] + ".xcscheme"), "w") as f:
        f.write(scheme(fam))
print("generated", PROJ)
