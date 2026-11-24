---
kind: upgrade-guide
description: "Desktop product analytics now ships off and has a switch in General settings under Privacy; an explicitly saved enabled: true is kept."
---

# Desktop product analytics is off by default

## Change

Desktop used to send product usage events to the DeepSeek analytics collector with no user-facing control. The `product-analytics` row now ships `enabled: false`, and the `enabled` field defaults to `false`. General settings has a new **Product analytics** switch in the Privacy group, shown only on Desktop. Turning it on writes `enabled: true` to the profile patch (`$DSH_HOME/profiles/desktop/cordis.patch.yml`) and takes effect at once without a restart. Turning it off stops new events at once; events already queued for delivery may still be sent.

A profile patch that already carries `enabled: true` for the `product-analytics` row keeps it, so that profile keeps reporting and the switch shows on. A profile without that override reports nothing until the user turns the switch on. Ordinary Web never mounts the service and shows no switch.

Affected: Desktop profiles that relied on the old default of `true`, and recorded expectations or tests that assumed the policy starts enabled.

## Migration

1. To keep reporting on a Desktop install, open Settings, then General, then Privacy, and turn on **Product analytics**. Nothing else needs to change.
2. To enable it for a managed profile, add to the profile's `cordis.patch.yml`:

   ```yaml
   - id: product-analytics
     config:
       enabled: true
   ```

3. To remove an old explicit opt-in and return to the shipped default, delete the `enabled: true` override from that row or turn the switch off.
4. Confirm in Settings, General, Privacy: the **Product analytics** switch shows the intended state.
